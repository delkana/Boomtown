import type { GameState, Plot, Tenant, UnitKind } from "./types";
import { TICKS_PER_DAY, TICK_MINUTES, UNIT_DEFS, VISITOR_HISTORY_DAYS } from "./constants";
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
        if (appeal > 0) {
          // Appeal% is the chance a tenant signs a lease on THIS day; if they do,
          // they arrive at a random hour of the day (deterministic per day).
          const day = Math.floor(state.tick / TICKS_PER_DAY);
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
    }

    // Rent + upkeep settle once a day, at midnight — and we snapshot the day's
    // visitor counts for stores/restaurants/clinics so the inspector can chart them.
    if (isMidnight) {
      owner.money += projectedDailyNet(plot);
      const dayEnded = state.tick / TICKS_PER_DAY - 1; // the day that just closed out
      for (const unit of plot.units) {
        if (!VISITOR_KINDS.has(unit.kind) || !unit.tenant) continue;
        const t = unit.tenant;
        const hist = (t.visitors ??= []);
        hist.push(dailyVisitors(unit.kind, t, unit.id, dayEnded));
        if (hist.length > VISITOR_HISTORY_DAYS) hist.splice(0, hist.length - VISITOR_HISTORY_DAYS);
      }
    }
  }
}

/** Businesses that draw counted daily visitors (shoppers / diners / patients). */
const VISITOR_KINDS = new Set<UnitKind>(["store", "restaurant", "medical"]);

/**
 * A plausible, deterministic count of paying visitors for a business on the day
 * that just ended: scaled by appeal, shaped by the weekday (shops/restaurants
 * peak on the weekend, clinics on weekdays), with a little daily noise. Zero on
 * days the business is closed.
 */
function dailyVisitors(kind: UnitKind, tenant: Tenant, unitId: string, dayEnded: number): number {
  const weekday = ((dayEnded % 7) + 7) % 7; // 0 = Monday … 6 = Sunday
  if (!(tenant.openDays ?? []).includes(weekday)) return 0;
  const base = kind === "store" ? 150 : kind === "restaurant" ? 120 : 36; // medical
  let wk = 1;
  if (kind === "store") wk = weekday >= 4 ? 1.35 : 1; // Fri–Sun busier
  else if (kind === "restaurant") wk = weekday === 4 || weekday === 5 ? 1.4 : weekday === 6 ? 1.15 : 1;
  else wk = weekday === 0 ? 1.25 : weekday <= 4 ? 1 : 0.6; // clinics: Mondays busy, weekends light
  const appealF = 0.45 + 0.55 * Math.max(0, Math.min(1, tenant.appeal));
  const noise = 0.8 + (hashString(`${unitId}:vis:${dayEnded}`) % 41) / 100; // 0.80–1.20
  return Math.max(0, Math.round(base * appealF * wk * noise));
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
