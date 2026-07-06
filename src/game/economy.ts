import {
  GIRDER_BASE_COST,
  GIRDER_COST_PER_FLOOR,
  MAX_PLOT_COLS,
  MIN_PLOT_COLS,
  PLOT_COST_MAX,
  PLOT_COST_MIN,
} from "./constants";
import type { GameState } from "./types";

/**
 * Land pricing — pure helpers shared by the reducer (authority) and the UI
 * (display), so the number shown always matches the number charged.
 *
 * Two factors set the price of claiming a plot:
 *   1. Plot width — a base price scaling linearly from PLOT_COST_MIN (a
 *      MIN_PLOT_COLS plot) to PLOT_COST_MAX (a MAX_PLOT_COLS plot).
 *   2. How much land the player already holds — the Nth plot a player buys
 *      costs N× its base price (1st plot ×1, 2nd ×2, 3rd ×3, …).
 */

/** Cost of one girder tile on a given floor: base + per-floor surcharge. */
export function girderCost(row: number): number {
  return GIRDER_BASE_COST + GIRDER_COST_PER_FLOOR * row;
}

/** Base land price for a plot of the given width, before the ownership multiplier. */
export function plotBaseCost(cols: number): number {
  const span = MAX_PLOT_COLS - MIN_PLOT_COLS;
  const perTile = span > 0 ? (PLOT_COST_MAX - PLOT_COST_MIN) / span : 0;
  const clamped = Math.max(MIN_PLOT_COLS, Math.min(MAX_PLOT_COLS, cols));
  return Math.round(PLOT_COST_MIN + (clamped - MIN_PLOT_COLS) * perTile);
}

/** How many plots a player currently owns. */
export function playerPlotCount(state: GameState, playerId: string): number {
  let n = 0;
  for (const key of Object.keys(state.plots)) {
    if (state.plots[Number(key)].ownerId === playerId) n++;
  }
  return n;
}

/**
 * Price for `playerId` to claim `plotIndex` right now: the plot's base cost
 * times (plots already owned + 1).
 */
export function claimCost(state: GameState, playerId: string, plotIndex: number): number {
  const plot = state.plots[plotIndex];
  if (!plot) return Infinity;
  const multiplier = playerPlotCount(state, playerId) + 1;
  return plotBaseCost(plot.cols) * multiplier;
}
