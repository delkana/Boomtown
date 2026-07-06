import { MAX_ROWS, UNIT_DEFS, type RoomPrefs } from "./constants";
import type { Plot, Unit } from "./types";

/**
 * Per-tile quality heatmaps. Pure functions of a plot's layout, so they can be
 * visualized on the client now and feed desirability/economy later.
 *
 * Each `*Rating` returns a raw score; `heatT` normalizes to 0..1 where 1 is
 * "good" (green) and 0 is "bad" (red) for the overlay.
 */
export type HeatmapKind = "none" | "elevator" | "view" | "noise" | "foot" | "cleanliness";

/** The unit occupying a cell, if any. */
function unitAt(plot: Plot, col: number, row: number): Unit | undefined {
  return plot.units.find((u) => row === u.row && col >= u.col && col < u.col + u.width);
}

function cellHasRoom(plot: Plot, col: number, row: number): boolean {
  return plot.units.some((u) => row === u.row && col >= u.col && col < u.col + u.width);
}
function cellHasGirder(plot: Plot, col: number, row: number): boolean {
  return (plot.girders ?? []).some((g) => g.col === col && g.row === row);
}

/**
 * Elevator access: the ground floor never has a problem (100). Above ground it
 * starts at 100 next to an elevator and falls linearly to 0 at 12+ tiles away.
 */
export function elevatorAccess(plot: Plot, col: number, row: number): number {
  if (row === 0) return 100;
  let best = Infinity;
  for (const u of plot.units) {
    if (u.kind !== "elevator") continue;
    const d = Math.abs(u.col - col) + Math.abs(u.row - row);
    if (d < best) best = d;
  }
  if (best === Infinity || best >= 12) return 0;
  return Math.max(0, 100 * (1 - best / 12));
}

/**
 * View: +1 per floor of height, plus +20 for each orthogonal neighbor that is
 * open air (no girder, no room). "Below" only counts as an overhang — the ground
 * beneath a ground-floor tile gives no view.
 */
export function viewRating(plot: Plot, col: number, row: number): number {
  if (row < 0) return 0; // no view underground, ever
  const openAir = (c: number, r: number): boolean => {
    if (c < 0 || c >= plot.cols) return true; // beside the plot = open sky
    if (r >= MAX_ROWS) return true; // above the plot = open sky
    if (r < 0) return false; // the ground, not a view
    return !cellHasGirder(plot, c, r) && !cellHasRoom(plot, c, r);
  };
  let v = row;
  if (openAir(col, row + 1)) v += 20; // above
  if (openAir(col - 1, row)) v += 20; // left
  if (openAir(col + 1, row)) v += 20; // right
  if (row > 0 && openAir(col, row - 1)) v += 20; // below, only when an overhang
  return v;
}

/**
 * Noise: louder near the ground, and near elevators, lobbies, and offices
 * (each contributes within a few tiles, falling off with distance).
 */
export function noiseRating(plot: Plot, col: number, row: number): number {
  let n = Math.max(0, 30 - Math.abs(row) * 6); // ground-floor proximity
  for (const u of plot.units) {
    const weight = u.kind === "elevator" ? 25 : u.kind === "lobby" ? 20 : u.kind === "office" ? 15 : 0;
    if (!weight) continue;
    const dx = Math.max(0, u.col - col, col - (u.col + u.width - 1));
    const d = Math.abs(u.row - row) + dx;
    if (d <= 5) n += weight * (1 - d / 6);
  }
  return n;
}

/**
 * Foot traffic: heaviest on the ground floor (everyone passes through). On other
 * floors it peaks next to the elevator and scales with how many rooms share that
 * floor (more residents/workers = more people funneling to the elevator).
 */
export function footTraffic(plot: Plot, col: number, row: number): number {
  if (row === 0) return 100;
  const roomsOnFloor = plot.units.filter((u) => u.row === row && u.kind !== "elevator").length;
  if (roomsOnFloor === 0) return 0;
  let elevDist = Infinity;
  for (const u of plot.units) {
    if (u.kind !== "elevator") continue;
    const d = Math.abs(u.col - col) + Math.abs(u.row - row);
    if (d < elevDist) elevDist = d;
  }
  if (elevDist === Infinity) return 0; // no elevator reaches this room
  const proximity = Math.max(0, 1 - elevDist / 8);
  return Math.min(100, 15 + roomsOnFloor * 14 * proximity);
}

/**
 * A single factor's normalized "goodness" at a cell (0..1, 1 = good): high
 * elevator access, tall view, quiet, or busy foot traffic. This is the same
 * scale the heatmap overlay uses; `roomSatisfaction` blends these per a room's
 * preferences.
 */
function factorGoodness(factor: keyof RoomPrefs, plot: Plot, col: number, row: number): number {
  switch (factor) {
    case "elevator":
      return elevatorAccess(plot, col, row) / 100;
    case "view":
      return Math.min(1, viewRating(plot, col, row) / 130);
    case "noise":
      return 1 - Math.min(1, noiseRating(plot, col, row) / 90); // quiet = 1
    case "foot":
      return footTraffic(plot, col, row) / 100;
  }
}

/**
 * How well a room's location suits it, 0..1 ("appeal"). Blends the factors the
 * room cares about (UnitDef.prefs) by importance, honoring each factor's desired
 * direction. Rooms with no prefs (infrastructure) return 1. This is the ceiling
 * that a revenue room's occupancy climbs toward (see tick.ts).
 */
export function roomSatisfaction(plot: Plot, unit: Unit): number {
  const prefs = UNIT_DEFS[unit.kind].prefs;
  if (!prefs) return 1;
  let num = 0;
  let den = 0;
  for (let c = unit.col; c < unit.col + unit.width; c++) {
    for (const key of Object.keys(prefs) as (keyof RoomPrefs)[]) {
      const w = prefs[key];
      if (!w) continue;
      const g = factorGoodness(key, plot, c, unit.row);
      const value = w >= 0 ? g : 1 - g; // negative weight = wants the low end
      num += Math.abs(w) * value;
      den += Math.abs(w);
    }
  }
  const base = den === 0 ? 1 : num / den;
  // Rooms dislike being dirty (offices/clinics that go un-janitored, hotels that
  // go without housekeeping). Clean rooms are unaffected.
  const clean = Math.max(0, Math.min(1, (unit.cleanliness ?? 100) / 100));
  return base * (0.55 + 0.45 * clean);
}

/** Normalized 0..1 rating (1 = good/green, 0 = bad/red) for the overlay. */
export function heatT(kind: HeatmapKind, plot: Plot, col: number, row: number): number {
  switch (kind) {
    case "elevator":
      return elevatorAccess(plot, col, row) / 100;
    case "view":
      return Math.min(1, viewRating(plot, col, row) / 130);
    case "noise":
      return 1 - Math.min(1, noiseRating(plot, col, row) / 90);
    case "foot":
      return footTraffic(plot, col, row) / 100;
    case "cleanliness": {
      const u = unitAt(plot, col, row);
      return u ? Math.max(0, Math.min(1, (u.cleanliness ?? 100) / 100)) : 1;
    }
    default:
      return 1;
  }
}
