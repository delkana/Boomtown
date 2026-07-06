import type { GameState, Plot } from "./types";
import { UNIT_DEFS } from "./constants";
import { roomSatisfaction } from "./heatmaps";
import { advanceCars, servicedRows } from "./elevator";

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
    // A floor is only reachable if its shaft has a car running in it.
    const elevatorRows = servicedRows(plot);

    let net = 0;
    for (const unit of plot.units) {
      const def = UNIT_DEFS[unit.kind];
      net -= def.upkeep;

      if (def.incomeAtFull > 0) {
        const serviced = hasLobby && elevatorRows.has(unit.row);
        // Occupancy converges on how appealing the spot is for this room type
        // (its "satisfaction"); an unserviced room empties out entirely.
        const target = serviced ? roomSatisfaction(plot, unit) : 0;
        if (unit.occupancy < target) {
          unit.occupancy = Math.min(target, unit.occupancy + def.fillRate);
        } else {
          unit.occupancy = Math.max(target, unit.occupancy - def.fillRate * 0.5);
        }
        net += Math.round(def.incomeAtFull * unit.occupancy);
      }
    }

    owner.money += net;

    // Move the plot's elevator cars along their shafts for the next tick.
    advanceCars(plot);
  }
}

/** Total per-tick net cashflow for a plot (for the stats readout). */
export function projectedNet(plot: Plot): number {
  const hasLobby = plot.units.some((u) => u.kind === "lobby");
  const elevatorRows = servicedRows(plot);
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
