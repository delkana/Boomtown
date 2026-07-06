import type { GameState, Plot, Worker } from "../game/types";
import { elevatorRuns, stepCar } from "../game/elevator";
import { hashString } from "../game/hash";

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
  worker: Worker | null; // identity (name, title, shift…)
  roomLeft: number; // office footprint, for milling bounds
  roomW: number;
  deskX: number; // their spot in the room (fractional col)
  officeRow: number;
  shaftCol: number; // elevator column they use (−1 if their office is on the ground)
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
  color: string;
  worker: Worker | null;
}

const WORKER_COLORS = ["#39424f", "#4a3f2f", "#2f3a44", "#463a4a", "#3a4a3a", "#4a3a34", "#37414a", "#54473a"];

/** Room kinds whose staff commute in and work on-site (residents/guests don't). */
const WORKING_KINDS = new Set(["office", "medical", "store", "restaurant"]);

export class PeopleSim {
  private people = new Map<string, Person>();
  private cars = new Map<string, Car>();
  private t = 0; // accumulated sim seconds (drives milling)

  /** Advance the simulation. `hourF` 0..24, `dayIndex` 0=Mon, `dtSec` scaled by speed. */
  update(state: GameState, hourF: number, dayIndex: number, dtSec: number): void {
    this.reconcile(state);
    const dt = Math.min(dtSec, 0.1); // clamp long frame gaps
    this.t += dt;

    for (const key of Object.keys(state.plots)) {
      const plot = state.plots[Number(key)];
      if (!plot.cars || plot.cars.length === 0) continue;
      this.dispatch(plot, dt);
    }
    for (const p of this.people.values()) this.stepPerson(p, hourF, dayIndex, dt);
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
        out.push({ id: p.id, x: p.x, floor: p.floor, yOff: p.yOff, color: p.color, worker: p.worker });
      }
    }
    return out;
  }

  // --- reconcile desired workers + cars with the current state ---------------

  private reconcile(state: GameState): void {
    const desired = new Set<string>();
    const liveCars = new Set<string>();

    for (const key of Object.keys(state.plots)) {
      const plot = state.plots[Number(key)];
      // Cars.
      for (const car of plot.cars ?? []) {
        liveCars.add(car.id);
        if (!this.cars.has(car.id)) {
          this.cars.set(car.id, {
            col: car.col,
            pos: car.home ?? car.position,
            vel: 0,
            passengers: [],
            mode: "move",
            doorT: 0,
            dwell: 0,
            openElapsed: 0,
          });
        }
      }
      // Workers (offices, clinics, shops, restaurants) commuting to their room.
      for (const unit of plot.units) {
        if (!unit.tenant || !WORKING_KINDS.has(unit.kind)) continue;
        const shaftCol = unit.row === 0 ? -1 : this.shaftFor(plot, unit.col, unit.row);
        if (unit.row !== 0 && shaftCol === null) continue; // office unreachable by lift → no workers
        const count = Math.max(1, unit.tenant.employees);
        for (let i = 0; i < count; i++) {
          const id = `${plot.id}:${unit.id}:w${i}`;
          desired.add(id);
          const p = this.people.get(id) ?? this.createPerson(id, plot.index);
          // Keep identity/location/schedule fresh (tenant or layout may have changed).
          p.worker = unit.tenant.workers[i] ?? null;
          p.roomLeft = unit.col;
          p.roomW = unit.width;
          // Desks sit slightly inset from the side walls (not right at the edges).
          const margin = Math.min(0.25, unit.width * 0.14);
          p.deskX = unit.col + margin + ((i + 0.5) / count) * (unit.width - 2 * margin);
          p.officeRow = unit.row;
          p.shaftCol = shaftCol ?? -1;
          this.applySchedule(p);
          this.people.set(id, p);
        }
      }
    }

    for (const id of [...this.people.keys()]) if (!desired.has(id)) this.people.delete(id);
    for (const id of [...this.cars.keys()]) if (!liveCars.has(id)) this.cars.delete(id);
  }

  private createPerson(id: string, plotIndex: number): Person {
    const h = hashString(id);
    return {
      id,
      plotIndex,
      worker: null,
      roomLeft: 0,
      roomW: 1,
      deskX: 0,
      officeRow: 0,
      shaftCol: -1,
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
    // Arrive about an hour before the shift (±20 min); leave 1–15 min after.
    p.arriveHour = start - 1 + ((h % 40) - 20) / 60;
    p.departHour = end + (((h >>> 5) % 15) + 1) / 60;
  }

  /** Nearest elevator column reaching both the ground and the office floor. */
  private shaftFor(plot: Plot, officeCol: number, officeRow: number): number | null {
    const runs = elevatorRuns(plot).filter((r) => r.from <= 0 && r.to >= officeRow);
    if (runs.length === 0) return null;
    runs.sort((a, b) => Math.abs(a.col - officeCol) - Math.abs(b.col - officeCol));
    return runs[0].col;
  }

  // --- elevator dispatch -----------------------------------------------------

  private dispatch(plot: Plot, dt: number): void {
    const runs = elevatorRuns(plot);
    for (const car of plot.cars ?? []) {
      const cs = this.cars.get(car.id);
      if (!cs) continue;
      const run =
        runs.find((r) => r.col === car.col && Math.round(cs.pos) >= r.from && Math.round(cs.pos) <= r.to) ??
        runs.find((r) => r.col === car.col);
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
      if (!p) {
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

  private stepPerson(p: Person, hourF: number, dayIndex: number, dt: number): void {
    const openDay = p.openDays.includes(dayIndex);
    const active = openDay && hourF >= p.arriveHour && hourF < p.departHour;
    const leaving = hourF >= p.departHour || !openDay;
    const ground = p.officeRow === 0;
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
        if (walk(p.shaftCol + p.spread)) p.st = "waitUp";
        break;
      case "waitUp":
        p.floor = 0; // boarding handled by the car when its doors open
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
        } else {
          walk(this.millTarget(p), MILL_SPEED); // stand at a desk / amble about
        }
        break;
      case "leaveToLift":
        p.floor = p.officeRow;
        if (walk(p.shaftCol + p.spread)) p.st = "waitDown";
        break;
      case "waitDown":
        break; // boarding handled by the car
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
