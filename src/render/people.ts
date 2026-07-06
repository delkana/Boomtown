import type { GameState, Plot, Tenant } from "../game/types";
import { elevatorRuns, stepCar } from "../game/elevator";
import { hashString } from "../game/hash";

/**
 * PeopleSim — a client-side, visual-only simulation of the people moving through
 * the city (for now, office workers commuting to and from work). It reads the
 * authoritative GameState (offices, tenants, elevator cars) and produces smooth
 * per-frame positions for the renderer to draw. It also drives the elevator
 * cars: they answer hall calls (with a capacity, so people queue) and otherwise
 * return to their idle home floor.
 *
 * Nothing here affects the economy — it's purely what you see.
 */

const WALK_SPEED = 2.6; // fractional columns per second
const CAR_CAPACITY = 8;
const ENTRANCE_X = 0.7; // where people enter/leave, near the ground-floor lobby
const ARRIVE_EPS = 0.04;

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
  officeCol: number; // where they stand in the office (fractional col)
  officeRow: number;
  shaftCol: number; // elevator column they use (−1 if their office is on the ground)
  openDays: number[];
  arriveHour: number;
  departHour: number;
  spread: number; // small per-person x offset so they don't perfectly overlap
  color: string;
  // dynamic
  x: number;
  floor: number;
  st: PState;
  car: string | null;
}

interface Car {
  col: number;
  pos: number;
  passengers: string[];
}

const WORKER_COLORS = ["#39424f", "#4a3f2f", "#2f3a44", "#463a4a", "#3a4a3a", "#4a3a34", "#37414a", "#54473a"];

export class PeopleSim {
  private people = new Map<string, Person>();
  private cars = new Map<string, Car>();

  /** Advance the simulation. `hourF` 0..24, `dayIndex` 0=Mon, `dtSec` scaled by speed. */
  update(state: GameState, hourF: number, dayIndex: number, dtSec: number): void {
    this.reconcile(state);
    const dt = Math.min(dtSec, 0.1); // clamp long frame gaps

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

  /** Visible people on a plot, for drawing. */
  peopleIn(plotIndex: number): { x: number; floor: number; color: string }[] {
    const out: { x: number; floor: number; color: string }[] = [];
    for (const p of this.people.values()) {
      if (p.plotIndex === plotIndex && p.st !== "away") out.push({ x: p.x, floor: p.floor, color: p.color });
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
        if (!this.cars.has(car.id)) this.cars.set(car.id, { col: car.col, pos: car.home ?? car.position, passengers: [] });
      }
      // Office workers.
      for (const unit of plot.units) {
        if (unit.kind !== "office" || !unit.tenant) continue;
        const shaftCol = unit.row === 0 ? -1 : this.shaftFor(plot, unit.col, unit.row);
        if (unit.row !== 0 && shaftCol === null) continue; // office unreachable by lift → no workers
        const officeCol = unit.col + unit.width / 2;
        const count = Math.max(1, unit.tenant.employees);
        for (let i = 0; i < count; i++) {
          const id = `${plot.id}:${unit.id}:w${i}`;
          desired.add(id);
          const p = this.people.get(id) ?? this.createPerson(id, plot.index);
          // Keep location/schedule fresh (tenant or layout may have changed).
          p.officeCol = officeCol;
          p.officeRow = unit.row;
          p.shaftCol = shaftCol ?? -1;
          this.applySchedule(p, unit.tenant);
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
      officeCol: 0,
      officeRow: 0,
      shaftCol: -1,
      openDays: [],
      arriveHour: 8,
      departHour: 17,
      spread: ((h % 100) / 100 - 0.5) * 0.5,
      color: WORKER_COLORS[(h >>> 3) % WORKER_COLORS.length],
      x: ENTRANCE_X,
      floor: 0,
      st: "away",
      car: null,
    };
  }

  private applySchedule(p: Person, tenant: Tenant): void {
    const h = hashString(p.id);
    p.openDays = tenant.openDays;
    // Arrive about an hour before opening (±20 min); leave 1–15 min after close.
    p.arriveHour = tenant.openHour - 1 + ((h % 40) - 20) / 60;
    p.departHour = tenant.closeHour + (((h >>> 5) % 15) + 1) / 60;
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

      // Choose a target floor: serve passengers, else nearest hall call, else home.
      let target = car.home ?? car.position;
      if (cs.passengers.length > 0) {
        target = this.nearestFloor(cs.passengers.map((id) => this.destOf(id)), cs.pos, target);
      } else {
        const calls = this.waitingFloors(plot.index, car.col, run);
        if (calls.length > 0) target = this.nearestFloor(calls, cs.pos, target);
      }
      cs.pos = stepCar(cs.pos, target, run.from, run.to, dt).pos;

      // Board waiting workers when stopped at a floor (up to capacity).
      const f = Math.round(cs.pos);
      if (Math.abs(cs.pos - f) < 0.14 && f >= run.from && f <= run.to) {
        for (const p of this.people.values()) {
          if (cs.passengers.length >= CAR_CAPACITY) break;
          if (p.plotIndex !== plot.index || p.shaftCol !== car.col) continue;
          if ((p.st === "waitUp" || p.st === "waitDown") && Math.abs(p.floor - f) < 0.2) {
            p.car = car.id;
            p.st = p.st === "waitUp" ? "ride" : "rideDown";
            cs.passengers.push(p.id);
          }
        }
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

  private alight(car: Car | undefined, workerId: string): void {
    if (!car) return;
    const i = car.passengers.indexOf(workerId);
    if (i >= 0) car.passengers.splice(i, 1);
  }

  // --- per-worker state machine ---------------------------------------------

  private stepPerson(p: Person, hourF: number, dayIndex: number, dt: number): void {
    const openDay = p.openDays.includes(dayIndex);
    const active = openDay && hourF >= p.arriveHour && hourF < p.departHour;
    const leaving = hourF >= p.departHour || !openDay;
    const ground = p.officeRow === 0;
    const walk = (target: number): boolean => {
      const d = target - p.x;
      if (Math.abs(d) < ARRIVE_EPS) {
        p.x = target;
        return true;
      }
      p.x += Math.sign(d) * WALK_SPEED * dt;
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
        p.floor = 0; // boarding handled by dispatch
        break;
      case "ride": {
        const car = p.car ? this.cars.get(p.car) : undefined;
        if (!car) {
          p.st = "waitUp";
          p.car = null;
          break;
        }
        p.floor = car.pos;
        p.x = p.shaftCol + p.spread;
        if (Math.abs(car.pos - p.officeRow) < 0.1) {
          this.alight(car, p.id);
          p.floor = p.officeRow;
          p.car = null;
          p.st = "toRoom";
        }
        break;
      }
      case "toRoom":
        p.floor = p.officeRow;
        if (walk(p.officeCol + p.spread)) p.st = "atRoom";
        break;
      case "atRoom":
        p.floor = p.officeRow;
        if (leaving) p.st = ground ? "toExit" : "leaveToLift";
        break;
      case "leaveToLift":
        p.floor = p.officeRow;
        if (walk(p.shaftCol + p.spread)) p.st = "waitDown";
        break;
      case "waitDown":
        break; // boarding handled by dispatch
      case "rideDown": {
        const car = p.car ? this.cars.get(p.car) : undefined;
        if (!car) {
          p.st = "waitDown";
          p.car = null;
          break;
        }
        p.floor = car.pos;
        p.x = p.shaftCol + p.spread;
        if (Math.abs(car.pos) < 0.1) {
          this.alight(car, p.id);
          p.floor = 0;
          p.car = null;
          p.st = "toExit";
        }
        break;
      }
      case "toExit":
        p.floor = 0;
        if (walk(ENTRANCE_X + p.spread)) p.st = "away";
        break;
    }
  }
}
