import { MAX_ROWS } from "./constants";
import type { Plot } from "./types";

/**
 * Per-tile quality heatmaps. Pure functions of a plot's layout, so they can be
 * visualized on the client now and feed desirability/economy later.
 *
 * Each `*Rating` returns a raw score; `heatT` normalizes to 0..1 where 1 is
 * "good" (green) and 0 is "bad" (red) for the overlay.
 */
export type HeatmapKind = "none" | "elevator" | "view" | "noise";

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
  let n = Math.max(0, 30 - row * 6); // ground-floor proximity
  for (const u of plot.units) {
    const weight = u.kind === "elevator" ? 25 : u.kind === "lobby" ? 20 : u.kind === "office" ? 15 : 0;
    if (!weight) continue;
    const dx = Math.max(0, u.col - col, col - (u.col + u.width - 1));
    const d = Math.abs(u.row - row) + dx;
    if (d <= 5) n += weight * (1 - d / 6);
  }
  return n;
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
    default:
      return 1;
  }
}
