import type { GameState, Plot, Worker } from "../game/types";
import { elevatorRuns, carsInRun, stepCar } from "../game/elevator";
import { hashString } from "../game/hash";
import { personName } from "../game/names";
import { isVisitorKind, visitSchedule, type Visit } from "../game/visitors";

/**
 * PeopleSim — a client-side, visual-only simulation of the people moving through
 * the city (for now, office workers commuting to and from work). It reads the
 * authoritative GameState (offices, tenants, elevator cars) and produces smooth
 * per-frame positions for the renderer to draw. It also drives the elevator
 * cars: they answer hall calls (with a capacity, so people queue), stop fully at
 * a floor and open their doors to load/unload, and otherwise return to an idle
 * home floor.
 *
 * Nothing here affects the economy — it's purely what you see.
 */

const WALK_SPEED = 2.6; // fractional columns per second (commuting)
const MILL_SPEED = 1.1; // slower amble while milling about the office
const CAR_CAPACITY = 16;
const ENTRANCE_X = 0.7; // where people enter/leave, near the ground-floor lobby
const ARRIVE_EPS = 0.04;
const DOOR_TIME = 0.45; // seconds for the cabin doors to slide fully open/closed
const DWELL_TIME = 1.4; // seconds a car holds at a floor with its doors open
const REACT_MAX = 0.4; // people take up to this long to react + step on/off
const MILL_PERIOD = 7; // seconds between a worker picking a new spot to stand
const MAX_VISITORS_RENDERED = 12; // cap concurrent walking customers per business (chart count is uncapped)
const VISITOR_EXIT_BUFFER = 0.4; // keep a customer around this many hours past departure so they finish walking out
/** What a customer is called when you hover them, by business kind. */
const VISITOR_TITLE: Record<string, string> = { store: "Shopper", restaurant: "Diner", medical: "Patient" };

// Hotel timings (in-game hours). Check-in mid-afternoon, guests drift in over
// the next few hours, sleep overnight, and check out by late morning.
const HOTEL_CHECKIN = 15; // 3pm
const HOTEL_ARRIVE_WINDOW = 6; // arrive up to 6h after check-in
const HOTEL_CHECKOUT = 11; // final checkout 11am next day
const HOTEL_SLOTS = 2; // up to 2 guests per booking

type PState =
  | "away"
  | "toLift"
  | "waitUp"
  | "ride"
  | "toRoom"
  | "atRoom"
  | "leaveToLift"
  | "waitDown"
  | "rideDown"
  | "toExit";

interface Person {
  id: string;
  plotIndex: number;
  isResident: boolean; // lives here + commutes OUT to work (vs. commuting IN)
  isHotel: boolean; // a hotel guest on a nightly booking (arrive → sleep → check out)
  roomId: string; // "${plot.id}:${unit.id}" — for per-room booking + lights
  appeal: number; // room appeal (drives hotel booking chance)
  sleeping: boolean; // hotel guest asleep in bed → hidden, light off
  worker: Worker | null; // identity (name, title, shift…)
  roomLeft: number; // office footprint, for milling bounds
  roomW: number;
  deskX: number; // their spot in the room (fractional col)
  officeRow: number;
  shaftCol: number; // elevator column they use (−1 if their office is on the ground)
  doorSide: "left" | "right"; // which side the shaft's cabin doors are on (where to queue)
  openDays: number[];
  arriveHour: number;
  departHour: number;
  spread: number; // small per-person offset so they don't perfectly overlap
  millPhase: number;
  react: number; // small delay before boarding/alighting, so crowds stagger
  depth: number; // how far back from the front edge they stand while at the office
  color: string;
  // dynamic
  x: number;
  floor: number;
  yOff: number; // upward render offset in cells (stand back from the bottom edge)
  st: PState;
  car: string | null;
}

interface Car {
  col: number;
  pos: number;
  vel: number;
  passengers: string[];
  /** "move" = travelling (doors shut); "load" = stopped at a floor, doors open. */
  mode: "move" | "load";
  doorT: number; // 0 shut … 1 fully open
  dwell: number; // seconds left holding at this floor
  openElapsed: number; // seconds the doors have been open (for staggered transfer)
}

/** What the renderer needs to draw + hit-test a person. */
export interface PersonView {
  id: string;
  x: number;
  floor: number;
  yOff: number; // upward offset in cells (stand back from the floor's front edge)
  sleeping: boolean; // asleep in bed → drawn lying down
  color: string;
  worker: Worker | null;
}

const WORKER_COLORS = ["#39424f", "#4a3f2f", "#2f3a44", "#463a4a", "#3a4a3a", "#4a3a34", "#37414a", "#54473a"];

/**
 * Room kinds whose people the sim animates: workers who commute IN to work
 * (offices/clinics/shops/restaurants), apartment residents who live here and
 * commute OUT to a job, and hotel guests on nightly bookings (see stepPerson).
 */
const PEOPLE_KINDS = new Set(["office", "medical", "store", "restaurant", "apartment", "hotel"]);

export class PeopleSim {
  private people = new Map<string, Person>();
  private cars = new Map<string, Car>();
  private litRooms = new Set<string>(); // roomIds with an awake person in them (rebuilt each frame)
  private t = 0; // accumulated sim seconds (drives milling)
  private archetype = "pacifica"; // city archetype (for hotel guest names)
  /** Cached daily visit schedule per room (regenerated when the day or tenant changes). */
  private visitCache = new Map<string, { day: number; sig: string; sched: Visit[] }>();

  /**
   * Advance the simulation. `hourF` 0..24, `dayIndex` 0=Mon, `absHour` is the
   * continuous in-game hour (for cross-midnight hotel bookings), `dtSec` scaled
   * by speed.
   */
  update(state: GameState, hourF: number, dayIndex: number, absHour: number, dtSec: number): void {
    this.archetype = state.config.archetype ?? "pacifica";
    this.reconcile(state, absHour);
    const dt = Math.min(dtSec, 0.1); // clamp long frame gaps
    this.t += dt;

    for (const key of Object.keys(state.plots)) {
      const plot = state.plots[Number(key)];
      if (!plot.cars || plot.cars.length === 0) continue;
      this.dispatch(plot, dt);
    }
    for (const p of this.people.values()) this.stepPerson(p, hourF, dayIndex, absHour, dt);

    // Rebuild the set of rooms with an awake occupant once (after stepping), so
    // roomLight() is O(1) per room instead of O(people) per lit room per frame.
    this.litRooms.clear();
    for (const p of this.people.values()) {
      if (p.st === "atRoom" && !p.sleeping) this.litRooms.add(p.roomId);
    }
  }

  /**
   * Whether an apartment/hotel room's light should be on: a resident is home, or
   * a hotel guest is in the room and awake. Null for other kinds (use tenant
   * hours). `roomId` is "${plot.id}:${unit.id}".
   */
  roomLight(roomId: string, kind: string): boolean | null {
    if (kind !== "apartment" && kind !== "hotel") return null;
    return this.litRooms.has(roomId);
  }

  /** Whether a person id still exists in the sim (for clearing stale track pins). */
  has(id: string): boolean {
    return this.people.has(id);
  }

  /** Smoothed car position (falls back to the authoritative one). */
  carPos(id: string, fallback: number): number {
    return this.cars.get(id)?.pos ?? fallback;
  }

  /** How far a car's doors are open (0 shut … 1 open). */
  carDoorOpen(id: string): number {
    return this.cars.get(id)?.doorT ?? 0;
  }

  /** Visible people on a plot, for drawing + hover hit-testing. */
  peopleIn(plotIndex: number): PersonView[] {
    const out: PersonView[] = [];
    for (const p of this.people.values()) {
      if (p.plotIndex === plotIndex && p.st !== "away") {
        const sleeping = p.sleeping && p.st === "atRoom"; // lie down only in the room
        out.push({ id: p.id, x: p.x, floor: p.floor, yOff: p.yOff, sleeping, color: p.color, worker: p.worker });
      }
    }
    return out;
  }

  // --- reconcile desired workers + cars with the current state ---------------

  private reconcile(state: GameState, absHour: number): void {
    const desired = new Set<string>();
    const liveCars = new Set<string>();
    const visitorRooms = new Set<string>(); // rooms that still have a visit schedule this pass
    const dayNumber = Math.floor(absHour / 24);
    const hourOfDay = absHour - dayNumber * 24;

    for (const key of Object.keys(state.plots)) {
      const plot = state.plots[Number(key)];
      // Cars.
      for (const car of plot.cars ?? []) {
        liveCars.add(car.id);
        if (!this.cars.has(car.id)) {
          this.cars.set(car.id, {
            col: car.col,
            pos: car.home ?? car.position ?? 0,
            vel: 0,
            passengers: [],
            mode: "move",
            doorT: 0,
            dwell: 0,
            openElapsed: 0,
          });
        }
      }
      // People with a room to be in: staff commuting to work, or residents
      // living here and commuting out to a job.
      for (const unit of plot.units) {
        if (!unit.tenant || !PEOPLE_KINDS.has(unit.kind)) continue;
        const shaftCol = unit.row === 0 ? -1 : this.shaftFor(plot, unit.col, unit.row);
        if (unit.row !== 0 && shaftCol === null) continue; // room unreachable by lift → no people
        const roomId = `${plot.id}:${unit.id}`;
        const isHotel = unit.kind === "hotel";
        // Hotels always get 2 guest slots; whether each is actually booked is
        // decided per night (by appeal) in stepPerson.
        const count = isHotel ? HOTEL_SLOTS : Math.max(1, unit.tenant.employees);
        for (let i = 0; i < count; i++) {
          const id = `${roomId}:${isHotel ? "g" : "w"}${i}`;
          desired.add(id);
          const p = this.people.get(id) ?? this.createPerson(id, plot.index);
          // Keep identity/location/schedule fresh (tenant or layout may have changed).
          p.isResident = unit.kind === "apartment";
          p.isHotel = isHotel;
          p.roomId = roomId;
          p.appeal = unit.tenant.appeal ?? 0.5;
          if (!isHotel) p.worker = unit.tenant.workers[i] ?? null; // hotel identity set per booking
          p.roomLeft = unit.col;
          p.roomW = unit.width;
          // Desks sit slightly inset from the side walls (not right at the edges).
          const margin = Math.min(0.25, unit.width * 0.14);
          p.deskX = unit.col + margin + ((i + 0.5) / count) * (unit.width - 2 * margin);
          p.officeRow = unit.row;
          p.shaftCol = shaftCol ?? -1;
          p.doorSide = (plot.cars ?? []).find((c) => c.col === shaftCol)?.doorSide ?? "right";
          if (!isHotel) this.applySchedule(p);
          this.people.set(id, p);
        }
        // In addition to staff, spawn the customers currently visiting this
        // business (shoppers / diners / patients) from the shared visit schedule.
        if (isVisitorKind(unit.kind)) {
          visitorRooms.add(roomId);
          this.addVisitors(desired, plot, unit, roomId, shaftCol ?? -1, dayNumber, hourOfDay);
        }
      }
    }

    for (const id of [...this.people.keys()]) if (!desired.has(id)) this.people.delete(id);
    for (const id of [...this.cars.keys()]) if (!liveCars.has(id)) this.cars.delete(id);
    // Forget cached visit schedules for businesses that no longer exist.
    for (const roomId of [...this.visitCache.keys()]) if (!visitorRooms.has(roomId)) this.visitCache.delete(roomId);
  }

  /**
   * Add the customers currently inside a store/restaurant/clinic, drawn from the
   * same deterministic day schedule the server counts. Only visits in progress
   * (plus a short exit buffer) become people, and the concurrent count is capped
   * for performance — the charted daily total is never capped.
   */
  private addVisitors(
    desired: Set<string>,
    plot: Plot,
    unit: Plot["units"][number],
    roomId: string,
    shaftCol: number,
    dayNumber: number,
    hourOfDay: number,
  ): void {
    const tenant = unit.tenant;
    if (!tenant) return;
    const sig = `${tenant.subset}:${tenant.appeal}:${tenant.openHour}:${tenant.closeHour}`;
    let cached = this.visitCache.get(roomId);
    if (!cached || cached.day !== dayNumber || cached.sig !== sig) {
      cached = { day: dayNumber, sig, sched: visitSchedule(unit.kind, tenant, unit.id, dayNumber) };
      this.visitCache.set(roomId, cached);
    }
    const weekday = ((dayNumber % 7) + 7) % 7;
    const margin = Math.min(0.25, unit.width * 0.14);
    const title = VISITOR_TITLE[unit.kind] ?? "Visitor";
    let shown = 0;
    for (const v of cached.sched) {
      if (hourOfDay < v.arrive || hourOfDay >= v.depart + VISITOR_EXIT_BUFFER) continue; // not here now
      if (shown >= MAX_VISITORS_RENDERED) break;
      shown++;
      const id = `${roomId}:v${dayNumber}:${v.index}`;
      desired.add(id);
      const p = this.people.get(id) ?? this.createPerson(id, plot.index);
      const h = hashString(id);
      p.isResident = false;
      p.isHotel = false;
      p.roomId = roomId;
      p.appeal = tenant.appeal ?? 0.5;
      p.worker = { name: personName(this.archetype, h), title, dailySalary: 0, days: [weekday], startHour: v.arrive, endHour: v.depart, lunchHour: -1 };
      p.roomLeft = unit.col;
      p.roomW = unit.width;
      p.deskX = unit.col + margin + ((h % 1000) / 1000) * (unit.width - 2 * margin);
      p.officeRow = unit.row;
      p.shaftCol = shaftCol;
      p.doorSide = (plot.cars ?? []).find((c) => c.col === shaftCol)?.doorSide ?? "right";
      p.openDays = [weekday];
      p.arriveHour = v.arrive;
      p.departHour = v.depart;
      this.people.set(id, p);
    }
  }

  private createPerson(id: string, plotIndex: number): Person {
    const h = hashString(id);
    return {
      id,
      plotIndex,
      isResident: false,
      isHotel: false,
      roomId: "",
      appeal: 0.5,
      sleeping: false,
      worker: null,
      roomLeft: 0,
      roomW: 1,
      deskX: 0,
      officeRow: 0,
      shaftCol: -1,
      doorSide: "right",
      openDays: [],
      arriveHour: 8,
      departHour: 17,
      spread: ((h % 100) / 100 - 0.5) * 0.4,
      millPhase: (h % 1000) / 1000 * MILL_PERIOD,
      react: ((h >>> 11) % 100) / 100 * REACT_MAX,
      depth: 0.08 + ((h >>> 17) % 100) / 100 * 0.06, // 0.08–0.14 cells back from the front edge
      color: WORKER_COLORS[(h >>> 3) % WORKER_COLORS.length],
      x: ENTRANCE_X,
      floor: 0,
      yOff: 0,
      st: "away",
      car: null,
    };
  }

  private applySchedule(p: Person): void {
    const h = hashString(p.id);
    const w = p.worker;
    p.openDays = w ? w.days : [];
    const start = w ? w.startHour : 9;
    const end = w ? w.endHour : 17;
    if (p.isResident) {
      // arriveHour/departHour bound the AWAY window: they leave ~1h before work
      // and return when they get off. Outside this window they're home.
      p.arriveHour = start - 1 + ((h % 20) - 10) / 60;
      p.departHour = end + (h % 15) / 60;
    } else {
      // Arrive about an hour before the shift (±20 min); leave 1–15 min after.
      p.arriveHour = start - 1 + ((h % 40) - 20) / 60;
      p.departHour = end + (((h >>> 5) % 15) + 1) / 60;
    }
  }

  // --- resident sleep --------------------------------------------------------

  /** Whether an apartment resident is in their overnight sleep window right now. */
  private residentSleeping(p: Person, absHour: number): boolean {
    const today = Math.floor(absHour / 24);
    // Sleep runs overnight, so check a window that started this evening or last.
    for (const D of [today, today - 1]) {
      const s = this.residentSleepWindow(p, D);
      if (absHour >= s.bed && absHour < s.wake) return true;
    }
    return false;
  }

  /**
   * A resident's 8-hour sleep window for the night beginning on day `D` (times
   * in absolute hours). Kept ≥2h clear of their work shift on either side, with
   * a ±15-minute nightly wobble on when they nod off and wake.
   */
  private residentSleepWindow(p: Person, D: number): { bed: number; wake: number } {
    const w = p.worker;
    const ws = w ? w.startHour : 9;
    const we = w ? w.endHour : 17;
    const lo = Math.max(we + 2, 20); // asleep no earlier than 2h after work / 8pm
    const hi = Math.max(lo, ws + 14); // awake ≥2h before next day's start (ws+24-2-8)
    const baseBed = lo + (hashString(`${p.id}:bedbase`) % 1000) / 1000 * (hi - lo);
    const j = hashString(`${p.id}:sleep:${D}`);
    const jBed = ((j % 31) - 15) / 60; // ±15 min
    const jWake = (((j >>> 8) % 31) - 15) / 60;
    return { bed: D * 24 + baseBed + jBed, wake: D * 24 + baseBed + 8 + jWake };
  }

  // --- hotel nightly bookings ------------------------------------------------

  /** The active booking for a hotel guest slot at `absHour`, or null. */
  private hotelBooking(
    p: Person,
    absHour: number,
  ): { arrival: number; bedtime: number; wake: number; checkout: number; name: string } | null {
    const slot = p.id.endsWith(":g1") ? 1 : 0;
    const today = Math.floor(absHour / 24);
    // A booking checks in this afternoon, or checked in yesterday and is still
    // sleeping/checking out this morning — so consider today and yesterday.
    for (const day of [today, today - 1]) {
      const b = this.bookingFor(p.roomId, p.appeal, day, slot);
      if (b && absHour >= b.arrival && absHour < b.checkout) return b;
    }
    return null;
  }

  /**
   * The booking a room+slot has for check-in day `D` (times in absolute hours),
   * or null if the room isn't booked that night or the slot is unused. Whether a
   * room is booked is a per-night dice roll weighted by the room's appeal; 1 in 4
   * bookings is for 2 people.
   */
  private bookingFor(
    roomId: string,
    appeal: number,
    D: number,
    slot: number,
  ): { arrival: number; bedtime: number; wake: number; checkout: number; name: string } | null {
    if (D < 0) return null;
    if (hashString(`${roomId}:book:${D}`) % 10000 >= appeal * 10000) return null; // not booked tonight
    const guests = hashString(`${roomId}:cnt:${D}`) % 100 < 25 ? 2 : 1;
    if (slot >= guests) return null;
    const h = hashString(`${roomId}:g${slot}:${D}`);
    const base = D * 24;
    const arrival = base + HOTEL_CHECKIN + (h % (HOTEL_ARRIVE_WINDOW * 60)) / 60; // 3pm + 0–6h
    let bedtime = base + 20 + ((h >>> 6) % (4 * 60)) / 60; // 8pm–midnight
    if (bedtime < arrival + 1) bedtime = arrival + 1;
    const wake = bedtime + 6 + ((h >>> 12) % (3 * 60)) / 60; // sleep 6–9h
    const limit = base + 24 + HOTEL_CHECKOUT; // 11am the next day
    let checkout = wake + 0.25 + ((h >>> 18) % 90) / 60; // 15min–1h45 after waking
    if (checkout > limit) checkout = limit;
    return { arrival, bedtime, wake, checkout, name: personName(this.archetype, h) };
  }

  /**
   * Nearest elevator column reaching both the ground and the office floor AND
   * having a car (an empty shaft can't carry anyone — without this check people
   * would queue forever at a shaft that never answers, e.g. after its car is
   * sold).
   */
  private shaftFor(plot: Plot, officeCol: number, officeRow: number): number | null {
    const runs = elevatorRuns(plot).filter(
      (r) => r.from <= 0 && r.to >= officeRow && carsInRun(plot, r).length > 0,
    );
    if (runs.length === 0) return null;
    runs.sort((a, b) => Math.abs(a.col - officeCol) - Math.abs(b.col - officeCol));
    return runs[0].col;
  }

  /** Vertical distance from a floor position to a run's [from,to] range (0 if inside). */
  private runDist(run: { from: number; to: number }, pos: number): number {
    return Math.max(0, run.from - pos, pos - run.to);
  }

  // --- elevator dispatch -----------------------------------------------------

  private dispatch(plot: Plot, dt: number): void {
    const runs = elevatorRuns(plot);
    for (const car of plot.cars ?? []) {
      const cs = this.cars.get(car.id);
      if (!cs) continue;
      // The run the car is in; if it's momentarily between disjoint runs in its
      // column, fall back to the NEAREST run (not just the first) so it isn't
      // clamped into the wrong shaft segment.
      const colRuns = runs.filter((r) => r.col === car.col);
      const run =
        colRuns.find((r) => Math.round(cs.pos) >= r.from && Math.round(cs.pos) <= r.to) ??
        colRuns.sort((a, b) => this.runDist(a, cs.pos) - this.runDist(b, cs.pos))[0];
      if (!run) continue;

      if (cs.mode === "load") {
        // Stopped at a floor: open, transfer, hold, then close and move on.
        cs.vel = 0;
        cs.dwell -= dt;
        if (cs.dwell > 0) {
          cs.doorT = Math.min(1, cs.doorT + dt / DOOR_TIME);
          if (cs.doorT >= 0.9) {
            cs.openElapsed += dt;
            this.transfer(plot, car, cs); // people step on/off staggered by their react time
          }
        } else {
          cs.doorT = Math.max(0, cs.doorT - dt / DOOR_TIME);
          if (cs.doorT <= 0.02) cs.mode = "move";
        }
        continue;
      }

      // Moving: doors shut. Pick a target and drive toward it.
      cs.doorT = Math.max(0, cs.doorT - dt / DOOR_TIME);
      let target = car.home ?? car.position;
      if (cs.passengers.length > 0) {
        target = this.nearestFloor(cs.passengers.map((id) => this.destOf(id)), cs.pos, target);
      } else {
        const calls = this.waitingFloors(plot.index, car.col, run);
        if (calls.length > 0) target = this.nearestFloor(calls, cs.pos, target);
      }
      const moved = stepCar(cs.pos, cs.vel, target, run.from, run.to, dt);
      cs.pos = moved.pos;
      cs.vel = moved.vel;

      // Arrived (fully stopped at a floor) with someone to drop or pick up?
      const f = Math.round(cs.pos);
      const stopped = Math.abs(cs.pos - f) < 0.03 && Math.abs(cs.vel) < 0.02;
      if (stopped && f >= run.from && f <= run.to && this.hasWork(plot, car, cs, f)) {
        cs.mode = "load";
        cs.dwell = DWELL_TIME;
        cs.openElapsed = 0;
        cs.vel = 0;
      }
    }
  }

  /** Whether a car stopped at floor F has anyone to unload or (room to) board. */
  private hasWork(plot: Plot, car: { col: number }, cs: Car, f: number): boolean {
    if (cs.passengers.some((id) => this.destOf(id) === f)) return true;
    if (cs.passengers.length >= CAR_CAPACITY) return false;
    for (const p of this.people.values()) {
      if (p.plotIndex !== plot.index || p.shaftCol !== car.col) continue;
      if ((p.st === "waitUp" || p.st === "waitDown") && Math.round(p.floor) === f) return true;
    }
    return false;
  }

  /**
   * Drop passengers whose floor this is, then board waiters (up to capacity).
   * Each person only steps once the doors have been open past their personal
   * `react` delay, so a crowd files on/off over ~half a second rather than all
   * moving on the same frame like a hive mind.
   */
  private transfer(plot: Plot, car: { id: string; col: number }, cs: Car): void {
    const f = Math.round(cs.pos);
    for (const id of [...cs.passengers]) {
      const p = this.people.get(id);
      // Drop anyone who's gone, or no longer actually riding (state desynced) —
      // otherwise a "ghost" passenger would silently eat the car's capacity.
      if (!p || this.destOf(id) === null) {
        if (p) p.car = null;
        this.alight(cs, id);
        continue;
      }
      if (this.destOf(id) === f && cs.openElapsed >= p.react) {
        this.alight(cs, id);
        p.car = null;
        if (p.st === "ride") {
          p.floor = p.officeRow;
          p.st = "toRoom";
        } else {
          p.floor = 0;
          p.st = "toExit";
        }
      }
    }
    for (const p of this.people.values()) {
      if (cs.passengers.length >= CAR_CAPACITY) break;
      if (p.plotIndex !== plot.index || p.shaftCol !== car.col) continue;
      if ((p.st === "waitUp" || p.st === "waitDown") && Math.round(p.floor) === f && cs.openElapsed >= p.react) {
        p.car = car.id;
        p.st = p.st === "waitUp" ? "ride" : "rideDown";
        cs.passengers.push(p.id);
      }
    }
  }

  private destOf(workerId: string): number | null {
    const p = this.people.get(workerId);
    if (!p) return null;
    if (p.st === "ride") return p.officeRow;
    if (p.st === "rideDown") return 0;
    return null;
  }

  private waitingFloors(plotIndex: number, col: number, run: { from: number; to: number }): number[] {
    const floors: number[] = [];
    for (const p of this.people.values()) {
      if (p.plotIndex !== plotIndex || p.shaftCol !== col) continue;
      if (p.st !== "waitUp" && p.st !== "waitDown") continue;
      const f = Math.round(p.floor);
      if (f >= run.from && f <= run.to && !floors.includes(f)) floors.push(f);
    }
    return floors;
  }

  private nearestFloor(candidates: (number | null)[], pos: number, fallback: number): number {
    let best = fallback;
    let bestD = Infinity;
    for (const c of candidates) {
      if (c === null) continue;
      const d = Math.abs(c - pos);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  private alight(car: Car, workerId: string): void {
    const i = car.passengers.indexOf(workerId);
    if (i >= 0) car.passengers.splice(i, 1);
  }

  // --- per-worker state machine ---------------------------------------------

  private stepPerson(p: Person, hourF: number, dayIndex: number, absHour: number, dt: number): void {
    // `active` = should be in the room; `leaving` = should head out.
    let active: boolean;
    let leaving: boolean;
    p.sleeping = false; // hotel/resident set this when in their sleep window
    if (p.isHotel) {
      // Hotel guest: present between arrival and checkout for tonight's booking
      // (if any), asleep in bed during their sleep window.
      const b = this.hotelBooking(p, absHour);
      if (b) {
        p.sleeping = absHour >= b.bedtime && absHour < b.wake;
        if (!p.worker || p.worker.name !== b.name) {
          p.worker = { name: b.name, title: "", dailySalary: 0, days: [], startHour: 0, endHour: 0, lunchHour: -1 };
        }
        active = true;
        leaving = false;
      } else {
        active = false; // no booking → not arrived, or already checked out
        leaving = true; // if still in the room after checkout, head out
      }
    } else if (p.isResident) {
      // Home EXCEPT during work hours (they commute out); asleep overnight.
      const onDay = p.openDays.includes(dayIndex);
      const away = onDay && hourF >= p.arriveHour && hourF < p.departHour;
      active = !away;
      leaving = away;
      if (!away) p.sleeping = this.residentSleeping(p, absHour);
    } else {
      const onDay = p.openDays.includes(dayIndex);
      active = onDay && hourF >= p.arriveHour && hourF < p.departHour;
      leaving = !active; // head out whenever off the clock (robust across midnight)
    }
    const ground = p.officeRow === 0;
    // Queue on whichever side the cabin doors open (right by default).
    const liftX = p.shaftCol + (p.doorSide === "left" ? 0.25 : 0.75) + p.spread * 0.5;
    const walk = (target: number, speed = WALK_SPEED): boolean => {
      const d = target - p.x;
      if (Math.abs(d) < ARRIVE_EPS) {
        p.x = target;
        return true;
      }
      p.x += Math.sign(d) * speed * dt;
      if ((d > 0 && p.x > target) || (d < 0 && p.x < target)) p.x = target;
      return false;
    };

    switch (p.st) {
      case "away":
        if (active) {
          p.x = ENTRANCE_X + p.spread;
          p.floor = 0;
          p.car = null;
          p.st = ground ? "toRoom" : "toLift";
        }
        break;
      case "toLift":
        if (walk(liftX)) p.st = "waitUp";
        break;
      case "waitUp":
        p.floor = 0;
        p.x = liftX; // wait on the door side; boarding handled when doors open
        break;
      case "ride": {
        const car = p.car ? this.cars.get(p.car) : undefined;
        if (!car) {
          p.st = "waitUp";
          p.car = null;
          break;
        }
        p.floor = car.pos;
        p.x = p.shaftCol + 0.5 + p.spread; // stand out on the cabin floor
        break; // the car drops us off (sets st) when its doors open at our floor
      }
      case "toRoom":
        p.floor = p.officeRow;
        if (walk(p.deskX + p.spread)) p.st = "atRoom";
        break;
      case "atRoom":
        p.floor = p.officeRow;
        if (leaving) {
          p.st = ground ? "toExit" : "leaveToLift";
        } else if (p.sleeping) {
          walk(p.deskX, MILL_SPEED); // settle at their bed spot and stay
        } else {
          walk(this.millTarget(p), MILL_SPEED); // stand at a desk / amble about
        }
        break;
      case "leaveToLift":
        p.floor = p.officeRow;
        if (walk(liftX)) p.st = "waitDown";
        break;
      case "waitDown":
        p.x = liftX; // wait on the door side; boarding handled when doors open
        break;
      case "rideDown": {
        const car = p.car ? this.cars.get(p.car) : undefined;
        if (!car) {
          p.st = "waitDown";
          p.car = null;
          break;
        }
        p.floor = car.pos;
        p.x = p.shaftCol + 0.5 + p.spread;
        break;
      }
      case "toExit":
        p.floor = 0;
        if (walk(ENTRANCE_X + p.spread)) p.st = "away";
        break;
    }
    // While in the office, stand back from the room's front (bottom) edge.
    p.yOff = p.st === "atRoom" || p.st === "toRoom" || p.st === "leaveToLift" ? p.depth : 0;
  }

  /**
   * Where a worker is standing right now while "at the office": mostly at their
   * own desk, but every so often ambling to a random spot in the room. Chosen
   * deterministically from the sim clock so there's no per-frame jitter.
   */
  private millTarget(p: Person): number {
    const idx = Math.floor((this.t + p.millPhase) / MILL_PERIOD);
    const rh = hashString(`${p.id}:${idx}`);
    if (rh % 100 < 55) return p.deskX + p.spread; // most of the time, at the desk
    // Amble within the room, keeping a little off the side walls.
    const inset = 0.28;
    const span = Math.max(0.2, p.roomW - inset * 2);
    return p.roomLeft + inset + ((rh >>> 7) % 1000) / 1000 * span;
  }
}
