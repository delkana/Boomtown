import type { GameState, Plot, Unit } from "./types";
import {
  CLEANLINESS_MAX,
  HOTEL_CHECKOUT_DIRT,
  OFFICE_DIRT_PER_HOUR,
  TICKS_PER_DAY,
  TICK_MINUTES,
  UNIT_DEFS,
  VISITOR_HISTORY_DAYS,
} from "./constants";
import { roomSatisfaction } from "./heatmaps";
import { servicedRows } from "./elevator";
import { generateTenant, hasTrades, tenantOpen } from "./tenants";
import { hashString } from "./hash";
import { isVisitorKind, visitCount } from "./visitors";
import { runMedicalDay } from "./medical";

const FIVE_AM_TICK = (5 * 60) / TICK_MINUTES; // janitors finish the offices overnight
const ELEVEN_AM_TICK = (11 * 60) / TICK_MINUTES; // hotel checkout / housekeeping

/** How much a dirty room's rent (and appeal) is discounted: 40% when filthy → 100% spotless. */
export function cleanlinessFactor(unit: Unit): number {
  const c = unit.cleanliness ?? CLEANLINESS_MAX;
  return 0.4 + 0.6 * Math.max(0, Math.min(1, c / CLEANLINESS_MAX));
}

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
  const tod = state.tick % TICKS_PER_DAY; // ticks elapsed into the current day
  const day = Math.floor(state.tick / TICKS_PER_DAY);
  const hourF = (tod * TICK_MINUTES) / 60;
  const weekday = ((day % 7) + 7) % 7;
  const dayEnded = day - 1; // the day that just closed out (for the midnight settlement)

  // Settle the day's walk-in medical demand once, up front: credits clinic owners
  // $500 per patient seen and tells us each clinic's appointment count for its chart.
  const medicalAppts = isMidnight ? runMedicalDay(state, dayEnded) : null;

  for (const key of Object.keys(state.plots)) {
    const plot = state.plots[Number(key)];
    if (!plot.ownerId) continue; // stub neighbor plots don't simulate yet
    const owner = state.players[plot.ownerId];
    if (!owner) continue;

    const hasLobby = plot.units.some((u) => u.kind === "lobby");
    const hasJanitor = plot.units.some((u) => u.kind === "janitor");
    const hasHousekeeping = plot.units.some((u) => u.kind === "housekeeping");
    const elevatorRows = servicedRows(plot);

    // Tenants move in and out.
    for (const unit of plot.units) {
      if (!hasTrades(unit.kind)) continue; // infrastructure has no tenant
      const serviced = hasLobby && elevatorRows.has(unit.row);
      if (unit.tenant) {
        if (!serviced) unit.tenant = null; // no elevator service → tenant leaves
      } else if (serviced) {
        const appeal = roomSatisfaction(plot, unit);
        if (appeal > 0) {
          // Appeal% is the chance a tenant signs a lease on THIS day; if they do,
          // they arrive at a random hour of the day (deterministic per day).
          const signs = hashString(`${plot.id}:${unit.id}:movein:${day}`) % 10000 < appeal * 10000;
          if (signs) {
            const moveHour = 6 + (hashString(`${plot.id}:${unit.id}:hour:${day}`) % 14); // 6am–7pm
            const moveTick = day * TICKS_PER_DAY + moveHour * (60 / TICK_MINUTES);
            if (state.tick >= moveTick) {
              unit.tenant = generateTenant(unit.kind, `${plot.id}:${unit.id}`, appeal, unit.width, state.config.archetype);
            }
          }
        }
      }
      unit.occupancy = unit.tenant ? 1 : 0;

      // --- Cleanliness ---
      if (unit.cleanliness == null) unit.cleanliness = CLEANLINESS_MAX;
      // Offices/clinics get grubbier every hour they're open + worked.
      if (
        unit.tenant &&
        (unit.kind === "office" || unit.kind === "medical") &&
        tenantOpen(unit.tenant, hourF, weekday)
      ) {
        unit.cleanliness = Math.max(0, unit.cleanliness - (OFFICE_DIRT_PER_HOUR * TICK_MINUTES) / 60);
      }
      // Janitors clean the offices overnight (once, at end of their shift) if a
      // janitor's closet exists in the tower.
      if (tod === FIVE_AM_TICK && hasJanitor && (unit.kind === "office" || unit.kind === "medical")) {
        unit.cleanliness = CLEANLINESS_MAX;
      }
      // Hotel rooms: a checkout each morning drops cleanliness sharply; a
      // housekeeping crew (if present) turns the room over back to spotless.
      if (tod === ELEVEN_AM_TICK && unit.kind === "hotel" && unit.tenant) {
        const booked = hashString(`${plot.id}:${unit.id}:book:${day - 1}`) % 10000 < (unit.tenant.appeal ?? 0) * 10000;
        if (booked) unit.cleanliness = Math.max(0, unit.cleanliness - HOTEL_CHECKOUT_DIRT);
        if (hasHousekeeping) unit.cleanliness = CLEANLINESS_MAX;
      }
    }

    // Rent + upkeep settle once a day, at midnight — and we snapshot the day's
    // visitor counts for stores/restaurants/clinics so the inspector can chart them.
    if (isMidnight) {
      owner.money += projectedDailyNet(plot);
      for (const unit of plot.units) {
        if (!isVisitorKind(unit.kind) || !unit.tenant) continue;
        const t = unit.tenant;
        const hist = (t.visitors ??= []);
        // Clinics chart the real walk-in appointments they handled; shops and
        // restaurants chart the same visit schedule the client renders.
        const count =
          unit.kind === "medical" ? (medicalAppts?.get(unit.id) ?? 0) : visitCount(unit.kind, t, unit.id, dayEnded);
        hist.push(count);
        if (hist.length > VISITOR_HISTORY_DAYS) hist.splice(0, hist.length - VISITOR_HISTORY_DAYS);
      }
    }
  }
}


/** Projected daily net cashflow for a plot: tenants' rent minus daily upkeep. */
export function projectedDailyNet(plot: Plot): number {
  let net = 0;
  for (const unit of plot.units) {
    net -= UNIT_DEFS[unit.kind].upkeep;
    // A dirty room earns less rent, so keeping it clean pays for the cleaners.
    if (unit.tenant) net += Math.round(unit.tenant.dailyRent * cleanlinessFactor(unit));
  }
  return net;
}
