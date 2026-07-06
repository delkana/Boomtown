import { hashString } from "./hash";
import type { Tenant, UnitKind } from "./types";

/**
 * Customer foot-traffic model for stores (shoppers), restaurants (diners) and
 * clinics (patients). ONE deterministic daily schedule is the single source of
 * truth, used two ways:
 *   - the server (advanceTick) counts a day's visits for the inspector chart;
 *   - the client (render/people.ts) renders whichever visits are happening right
 *     now as walking customers.
 * So the charted number is the real count of visits, and the people you see are
 * a subset of it — no more made-up figures disconnected from anyone visible.
 *
 * Pure + deterministic (hash of unit id + day), so client and server always
 * agree without sending any per-visitor data over the wire.
 */

/** One visit window, in hours within its day (0..24). `index` seeds the name. */
export interface Visit {
  arrive: number;
  depart: number;
  index: number;
}

/** Daily visitor volume per business kind, before appeal/weekday scaling. */
const BASE: Partial<Record<UnitKind, number>> = { store: 150, restaurant: 120, medical: 36 };
/** Typical time a customer spends inside (hours), varied per visit. */
const DURATION: Partial<Record<UnitKind, number>> = { store: 0.5, restaurant: 1.2, medical: 0.6 };

/** Does this kind of business draw counted customers? */
export function isVisitorKind(kind: UnitKind): boolean {
  return kind in BASE;
}

/** Weekday demand shape: shops/restaurants peak on the weekend, clinics on weekdays. */
function weekdayFactor(kind: UnitKind, weekday: number): number {
  if (kind === "store") return weekday >= 4 ? 1.35 : 1; // Fri–Sun busier
  if (kind === "restaurant") return weekday === 4 || weekday === 5 ? 1.4 : weekday === 6 ? 1.15 : 1;
  return weekday === 0 ? 1.25 : weekday <= 4 ? 1 : 0.6; // clinics: Mondays busy, weekends light
}

/**
 * How many customers a business draws on a given day. Deterministic; scaled by
 * appeal, shaped by the weekday, with a little daily noise. Zero when closed.
 */
export function visitCount(kind: UnitKind, tenant: Tenant, unitId: string, dayNumber: number): number {
  const base = BASE[kind];
  if (!base) return 0;
  const weekday = ((dayNumber % 7) + 7) % 7; // 0 = Monday … 6 = Sunday
  if (!(tenant.openDays ?? []).includes(weekday)) return 0;
  const appealF = 0.45 + 0.55 * Math.max(0, Math.min(1, tenant.appeal));
  const wk = weekdayFactor(kind, weekday);
  const noise = 0.8 + (hashString(`${unitId}:vis:${dayNumber}`) % 41) / 100; // 0.80–1.20
  return Math.max(0, Math.round(base * appealF * wk * noise));
}

/**
 * The day's visit windows, arrivals spread across the business's open hours with
 * per-visit jitter and a varied dwell time. `visitSchedule(...).length` always
 * equals `visitCount(...)`, so the chart and the visible customers stay in sync.
 */
export function visitSchedule(kind: UnitKind, tenant: Tenant, unitId: string, dayNumber: number): Visit[] {
  const n = visitCount(kind, tenant, unitId, dayNumber);
  if (n === 0) return [];
  const open = tenant.openHour;
  const close = tenant.closeHour;
  const span = Math.max(1, close - open);
  const dur = DURATION[kind] ?? 0.5;
  const out: Visit[] = [];
  for (let i = 0; i < n; i++) {
    const h = hashString(`${unitId}:v:${dayNumber}:${i}`);
    const frac = (i + (h % 1000) / 1000) / n; // spread across open hours, evenly + jittered
    const arrive = open + frac * span;
    const d = dur * (0.6 + ((h >>> 10) % 80) / 100); // ±dwell variance
    out.push({ arrive, depart: Math.min(close, arrive + d), index: i });
  }
  return out;
}

/** Which visits from a day's schedule are in progress at `hourOfDay` (few at once). */
export function activeVisits(schedule: Visit[], hourOfDay: number): Visit[] {
  const out: Visit[] = [];
  for (const v of schedule) if (hourOfDay >= v.arrive && hourOfDay < v.depart) out.push(v);
  return out;
}
