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

/**
 * Floors a car travels per SECOND of real time at 1× game speed. Car motion is
 * continuous (animated every frame, scaled by game speed) rather than stepped
 * per economy tick — see `stepCar`.
 */
export const CAR_SPEED = 1.1;

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

/**
 * The contiguous run bounds a would-be elevator at (col,row) would belong to —
 * scanning the existing elevator cells above and below it in that column. Used
 * before a segment is placed to decide whether its shaft already has a car.
 */
export function shaftBoundsWith(plot: Plot, col: number, row: number): { from: number; to: number } {
  const has = (r: number): boolean => plot.units.some((u) => u.kind === "elevator" && u.col === col && u.row === r);
  let from = row;
  let to = row;
  while (has(from - 1)) from--;
  while (has(to + 1)) to++;
  return { from, to };
}

/**
 * Whether placing an elevator at (col,row) would form a shaft that has no car —
 * i.e. the placement should come bundled with its first car. True for a brand
 * new shaft; false when it merely extends a shaft that already has one.
 */
export function autoCarNeeded(plot: Plot, col: number, row: number): boolean {
  const { from, to } = shaftBoundsWith(plot, col, row);
  return !(plot.cars ?? []).some(
    (c) => c.col === col && Math.round(c.position) >= from && Math.round(c.position) <= to,
  );
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
 * Move a car toward `target` floor by `dt` seconds (already scaled by game
 * speed), clamped to the shaft [from,to], stopping exactly at the target (no
 * overshoot). Cars sit still once they reach it — passenger routing will later
 * drive the target. Pure — returns the new position.
 */
export function stepCar(pos: number, target: number, from: number, to: number, dt: number): { pos: number } {
  const tgt = Math.max(from, Math.min(to, target));
  const d = tgt - pos;
  if (Math.abs(d) < 0.02) return { pos: tgt };
  const next = pos + Math.sign(d) * CAR_SPEED * dt;
  if ((d > 0 && next >= tgt) || (d < 0 && next <= tgt)) return { pos: tgt };
  return { pos: next };
}

/**
 * Drop any car whose shaft was removed from under it (e.g. its elevator segments
 * were sold). Call after a change that can shrink a shaft. Mutates in place.
 */
export function pruneOrphanCars(plot: Plot): void {
  if (!plot.cars || plot.cars.length === 0) return;
  const runs = elevatorRuns(plot);
  plot.cars = plot.cars.filter((c) =>
    runs.some((r) => r.col === c.col && Math.round(c.position) >= r.from && Math.round(c.position) <= r.to),
  );
}
