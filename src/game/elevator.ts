import type { ElevatorCar, Plot } from "./types";

/**
 * Elevator model — pure, server-ownable.
 *
 * A "shaft" (bank) is a maximal contiguous vertical run of `elevator` units in
 * a single column. Cars live inside shafts and are what actually move people:
 *   - a floor is only *serviced* if it sits in a shaft that has ≥1 car;
 *   - a shaft holds at most MAX_CARS_PER_SHAFT cars;
 *   - each tick cars travel along their shaft (today they patrol end to end;
 *     once passengers exist they'll answer calls — the movement loop is the
 *     hook for that).
 */

/** Up to this many cars can share one shaft (elevator bank). */
export const MAX_CARS_PER_SHAFT = 8;

/** Floors a patrolling car moves per tick (a tick is TICK_MINUTES of game time). */
export const CAR_SPEED = 0.34;

export interface ElevatorRun {
  col: number;
  /** Lowest floor of the run. */
  from: number;
  /** Highest floor of the run. */
  to: number;
}

/** Group a plot's elevator units into contiguous vertical runs (shafts) per column. */
export function elevatorRuns(plot: Plot): ElevatorRun[] {
  const byCol = new Map<number, number[]>();
  for (const u of plot.units) {
    if (u.kind !== "elevator") continue;
    const rows = byCol.get(u.col) ?? [];
    rows.push(u.row);
    byCol.set(u.col, rows);
  }
  const runs: ElevatorRun[] = [];
  for (const [col, rows] of byCol) {
    rows.sort((a, b) => a - b);
    let from = rows[0];
    let prev = rows[0];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i] === prev + 1) {
        prev = rows[i];
      } else {
        runs.push({ col, from, to: prev });
        from = rows[i];
        prev = rows[i];
      }
    }
    runs.push({ col, from, to: prev });
  }
  return runs;
}

/** The shaft run in `col` that contains `row`, or null if there's no shaft there. */
export function runContaining(plot: Plot, col: number, row: number): ElevatorRun | null {
  for (const r of elevatorRuns(plot)) {
    if (r.col === col && row >= r.from && row <= r.to) return r;
  }
  return null;
}

/** Cars currently within a given shaft run. */
export function carsInRun(plot: Plot, run: ElevatorRun): ElevatorCar[] {
  return (plot.cars ?? []).filter(
    (c) => c.col === run.col && Math.round(c.position) >= run.from && Math.round(c.position) <= run.to,
  );
}

/** The car nearest to (col,row) in a shaft, if any (used when removing one). */
export function nearestCar(plot: Plot, col: number, row: number): ElevatorCar | null {
  let best: ElevatorCar | null = null;
  let bestD = Infinity;
  for (const c of plot.cars ?? []) {
    if (c.col !== col) continue;
    const d = Math.abs(c.position - row);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/**
 * The set of floors that are actually serviced: every row inside a shaft that
 * has at least one car. A shaft with no car reaches no one.
 */
export function servicedRows(plot: Plot): Set<number> {
  const rows = new Set<number>();
  for (const run of elevatorRuns(plot)) {
    if (carsInRun(plot, run).length === 0) continue;
    for (let r = run.from; r <= run.to; r++) rows.add(r);
  }
  return rows;
}

/**
 * Advance every car one tick along its shaft. Cars patrol between the shaft's
 * top and bottom for now (bouncing at each end); a car whose shaft was removed
 * from under it drops out. Mutates the plot in place.
 */
export function advanceCars(plot: Plot): void {
  if (!plot.cars || plot.cars.length === 0) return;
  const runs = elevatorRuns(plot);
  const kept: ElevatorCar[] = [];
  for (const car of plot.cars) {
    const run = runs.find(
      (r) => r.col === car.col && Math.round(car.position) >= r.from && Math.round(car.position) <= r.to,
    );
    if (!run) continue; // shaft gone → the car is removed
    if (run.from === run.to) {
      car.position = run.from; // single-floor shaft: nothing to patrol
      kept.push(car);
      continue;
    }
    let dir = car.dir === 0 ? 1 : car.dir;
    let pos = car.position + CAR_SPEED * dir;
    if (pos >= run.to) {
      pos = run.to;
      dir = -1;
    } else if (pos <= run.from) {
      pos = run.from;
      dir = 1;
    }
    car.position = pos;
    car.dir = dir;
    kept.push(car);
  }
  plot.cars = kept;
}
