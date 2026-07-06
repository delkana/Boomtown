import type { GameState, Plot } from "./types";
import { TICKS_PER_DAY, UNIT_DEFS } from "./constants";
import { roomSatisfaction } from "./heatmaps";
import { servicedRows } from "./elevator";
import { generateTenant, hasTrades } from "./tenants";
import { hashString } from "./hash";

/**
 * advanceTick: the economy step. Pure and deterministic — server-ownable.
 *
 * Each tick, for every owned plot:
 *   1. Serviced revenue rooms (lobby + an elevator car reaches the floor) attract
 *      a tenant over time, weighted by how appealing the spot is. A room with no
 *      service loses its tenant.
 *   2. Once a day, at midnight, rent is collected from every tenant and daily
 *      upkeep is paid — so cashflow is lumpy (a payday each night), not per-tick.
 */
export function advanceTick(state: GameState): void {
  state.tick += 1;
  const isMidnight = state.tick % TICKS_PER_DAY === 0;

  for (const key of Object.keys(state.plots)) {
    const plot = state.plots[Number(key)];
    if (!plot.ownerId) continue; // stub neighbor plots don't simulate yet
    const owner = state.players[plot.ownerId];
    if (!owner) continue;

    const hasLobby = plot.units.some((u) => u.kind === "lobby");
    const elevatorRows = servicedRows(plot);

    // Tenants move in and out.
    for (const unit of plot.units) {
      if (!hasTrades(unit.kind)) continue; // infrastructure has no tenant
      const serviced = hasLobby && elevatorRows.has(unit.row);
      if (unit.tenant) {
        if (!serviced) unit.tenant = null; // no elevator service → tenant leaves
      } else if (serviced) {
        const appeal = roomSatisfaction(plot, unit);
        const roll = hashString(`${plot.id}:${unit.id}:${state.tick}`) % 1000;
        if (appeal > 0 && roll < appeal * 140) {
          // Identity is stable per room; appeal at move-in sets the rent.
          unit.tenant = generateTenant(unit.kind, `${plot.id}:${unit.id}`, appeal, unit.width);
        }
      }
      unit.occupancy = unit.tenant ? 1 : 0;
    }

    // Rent + upkeep settle once a day, at midnight.
    if (isMidnight) owner.money += projectedDailyNet(plot);
  }
}

/** Projected daily net cashflow for a plot: tenants' rent minus daily upkeep. */
export function projectedDailyNet(plot: Plot): number {
  let net = 0;
  for (const unit of plot.units) {
    net -= UNIT_DEFS[unit.kind].upkeep;
    if (unit.tenant) net += unit.tenant.dailyRent;
  }
  return net;
}
