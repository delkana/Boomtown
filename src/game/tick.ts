import type { GameState, Plot } from "./types";
import { UNIT_DEFS } from "./constants";

/**
 * advanceTick: the economy step. Pure and deterministic — server-ownable.
 *
 * Per tick, for every owned plot:
 *   1. Revenue units (offices/apartments) that are "serviced" fill up toward
 *      full occupancy; unserviced ones slowly drain.
 *   2. Each unit yields income = incomeAtFull * occupancy, minus upkeep.
 *   3. The plot owner's wallet is credited/debited.
 *
 * "Serviced" = the tower has a lobby AND an elevator reaches the unit's floor.
 * This is intentionally simple; it's the hook where richer sims (pathing,
 * demand curves) would slot in later.
 */
export function advanceTick(state: GameState): void {
  state.tick += 1;

  for (const key of Object.keys(state.plots)) {
    const plot = state.plots[Number(key)];
    if (!plot.ownerId) continue; // stub neighbor plots don't simulate yet
    const owner = state.players[plot.ownerId];
    if (!owner) continue;

    const hasLobby = plot.units.some((u) => u.kind === "lobby");
    const elevatorRows = elevatorReach(plot);

    let net = 0;
    for (const unit of plot.units) {
      const def = UNIT_DEFS[unit.kind];
      net -= def.upkeep;

      if (def.incomeAtFull > 0) {
        const serviced = hasLobby && elevatorRows.has(unit.row);
        if (serviced) {
          unit.occupancy = Math.min(1, unit.occupancy + def.fillRate);
        } else {
          // Tenants leave if they can't get to their floor.
          unit.occupancy = Math.max(0, unit.occupancy - def.fillRate * 0.5);
        }
        net += Math.round(def.incomeAtFull * unit.occupancy);
      }
    }

    owner.money += net;
  }
}

/**
 * Set of floor rows reachable by an elevator. An elevator cell services its own
 * floor; a floor is reachable if any elevator cell exists on it. (Elevators are
 * expected to be stacked into a shaft from the ground up.)
 */
function elevatorReach(plot: Plot): Set<number> {
  const rows = new Set<number>();
  for (const u of plot.units) {
    if (u.kind === "elevator") rows.add(u.row);
  }
  return rows;
}

/** Total per-tick net cashflow for a plot (for the stats readout). */
export function projectedNet(plot: Plot): number {
  const hasLobby = plot.units.some((u) => u.kind === "lobby");
  const elevatorRows = new Set(plot.units.filter((u) => u.kind === "elevator").map((u) => u.row));
  let net = 0;
  for (const unit of plot.units) {
    const def = UNIT_DEFS[unit.kind];
    net -= def.upkeep;
    if (def.incomeAtFull > 0 && hasLobby && elevatorRows.has(unit.row)) {
      net += Math.round(def.incomeAtFull * unit.occupancy);
    }
  }
  return net;
}
