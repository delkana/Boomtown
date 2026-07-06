import { UNIT_DEFS } from "./constants";
import { roomSatisfaction } from "./heatmaps";
import type { Plot } from "./types";

/**
 * A building's overall quality as a 0..5 star rating in half-star steps. It's the
 * average appeal of the tower's occupied revenue rooms (which already factors in
 * elevator access, views, quiet, foot traffic and cleanliness), so a well-placed,
 * clean, fully-leased tower rates highly and a grubby or awkward one rates low.
 */
export function buildingStars(plot: Plot): number {
  const rooms = plot.units.filter((u) => u.tenant && (UNIT_DEFS[u.kind].incomeAtFull ?? 0) > 0);
  if (rooms.length === 0) return 0;
  const avg = rooms.reduce((sum, u) => sum + roomSatisfaction(plot, u), 0) / rooms.length;
  return Math.round(Math.max(0, Math.min(5, avg * 5)) * 2) / 2; // nearest half-star
}

/** "★★★½☆" style string for a 0..5 half-star rating. */
export function starString(stars: number): string {
  const full = Math.floor(stars);
  const half = stars - full >= 0.5;
  return "★".repeat(full) + (half ? "½" : "") + "☆".repeat(5 - full - (half ? 1 : 0));
}
