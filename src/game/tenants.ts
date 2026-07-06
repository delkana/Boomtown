import { hashString } from "./hash";
import type { Tenant, UnitKind } from "./types";

/**
 * Tenants — the businesses/households that occupy revenue rooms. Pure and
 * deterministic: a room's tenant identity is a function of its stable id, so it
 * never changes once assigned. See tick.ts for move-in/out + daily rent.
 */

interface Trade {
  label: string;
  /** Business open/close hours; lights follow these (± an hour). */
  open: number;
  close: number;
  /** Weekdays open (0=Mon … 6=Sun); omitted = the kind's default. */
  days?: number[];
}

const WEEKDAYS = [0, 1, 2, 3, 4]; // Mon–Fri
const MON_SAT = [0, 1, 2, 3, 4, 5];
const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6];
const NOT_MONDAY = [1, 2, 3, 4, 5, 6];

/** Default operating days by kind (offices/clinics close on weekends). */
const DEFAULT_DAYS: Partial<Record<UnitKind, number[]>> = {
  office: WEEKDAYS,
  medical: WEEKDAYS,
  store: ALL_WEEK,
  restaurant: ALL_WEEK,
  apartment: ALL_WEEK,
  hotel: ALL_WEEK,
};

/** Trade pools per revenue kind (business types + their hours). */
const TRADES: Partial<Record<UnitKind, Trade[]>> = {
  office: [
    { label: "Law Offices", open: 8, close: 18 },
    { label: "Accounting Firm", open: 8, close: 17 },
    { label: "Insurance Agency", open: 9, close: 17 },
    { label: "Consulting Group", open: 9, close: 18 },
    { label: "Realty Group", open: 9, close: 19 },
    { label: "Architecture Studio", open: 9, close: 18 },
    { label: "Media Agency", open: 10, close: 19 },
    { label: "Software Labs", open: 10, close: 20 },
    { label: "Talent Agency", open: 9, close: 18 },
  ],
  medical: [
    { label: "Family Practice", open: 8, close: 17 },
    { label: "Dental Clinic", open: 8, close: 16, days: MON_SAT },
    { label: "Urgent Care", open: 8, close: 20, days: ALL_WEEK },
    { label: "Optometry Clinic", open: 9, close: 17 },
    { label: "Physical Therapy", open: 7, close: 19 },
    { label: "Pediatrics Clinic", open: 8, close: 17 },
    { label: "Dermatology Clinic", open: 9, close: 17 },
  ],
  store: [
    { label: "Grocer", open: 8, close: 21 },
    { label: "Boutique", open: 10, close: 20 },
    { label: "Bookshop", open: 10, close: 20 },
    { label: "Electronics", open: 10, close: 21 },
    { label: "Pharmacy", open: 8, close: 22 },
    { label: "Bakery", open: 7, close: 18 },
    { label: "Florist", open: 9, close: 19 },
    { label: "Outfitters", open: 10, close: 20 },
  ],
  restaurant: [
    { label: "Bistro", open: 11, close: 23 },
    { label: "Diner", open: 7, close: 22 },
    { label: "Grill House", open: 12, close: 23 },
    { label: "Ramen Bar", open: 11, close: 24 },
    { label: "Trattoria", open: 12, close: 23, days: NOT_MONDAY },
    { label: "Steakhouse", open: 16, close: 24, days: NOT_MONDAY },
    { label: "Cafe", open: 7, close: 19 },
  ],
  // Residential — lit late afternoon into the night.
  apartment: [
    { label: "Residences", open: 16, close: 24 },
    { label: "Lofts", open: 16, close: 24 },
    { label: "Flats", open: 15, close: 23 },
  ],
  hotel: [
    { label: "Suites", open: 14, close: 24 },
    { label: "Inn", open: 14, close: 24 },
  ],
};

/** Brand words used to build tenant names. */
const BRANDS = [
  "Halbrook", "Vance", "Sterling", "Meridian", "Ashcroft", "Kessler", "Oakmont", "Vireo",
  "Marlowe", "Copperfield", "Whitlock", "Pinnacle", "Larkspur", "Brenner", "Cavendish",
  "Fairmont", "Delacroix", "Quill", "Ridgeway", "Solace", "Blackwood", "Hartley", "Verity",
  "Nimbus", "Orion", "Sable", "Thorne", "Winslow", "Ashby", "Calloway", "Merrick", "Prescott",
];

/** People (employees or residents) per width tile, per kind. */
const HEADCOUNT: Partial<Record<UnitKind, number>> = {
  office: 4, medical: 3, store: 2, restaurant: 3, apartment: 2, hotel: 3,
};

/** Base daily rent per kind (scaled by appeal + a little variance). */
const RENT_BASE: Partial<Record<UnitKind, number>> = {
  office: 1400, medical: 1800, store: 1200, restaurant: 1600, apartment: 1000, hotel: 620,
};

function buildName(kind: UnitKind, trade: string, h: number): string {
  const b1 = BRANDS[(h >>> 3) % BRANDS.length];
  const b2 = BRANDS[(h >>> 13) % BRANDS.length];
  switch (kind) {
    case "office":
      return `${b1} & ${b2}`;
    case "restaurant":
      return `${b1}'s`;
    case "hotel":
      return `${b1} ${trade}`;
    case "apartment":
      return `${b1} ${trade}`;
    default: // medical / store
      return `${b1} ${trade}`;
  }
}

/** Whether a kind can hold a tenant at all. */
export function hasTrades(kind: UnitKind): boolean {
  return kind in TRADES;
}

/**
 * Deterministically generate the tenant for a room from its stable `seed`
 * (plot + unit id). `appeal` (0..1) at move-in time sets the rent; `width`
 * scales the headcount. Returns null for kinds that don't take tenants.
 */
export function generateTenant(kind: UnitKind, seed: string, appeal: number, width: number): Tenant | null {
  const trades = TRADES[kind];
  if (!trades) return null;
  const h = hashString(seed);
  const t = trades[h % trades.length];
  const per = HEADCOUNT[kind] ?? 2;
  const employees = Math.max(1, Math.round(per * width * (0.7 + ((h >>> 5) % 50) / 100)));
  const base = RENT_BASE[kind] ?? 1000;
  const dailyRent = Math.round(base * (0.5 + Math.max(0, Math.min(1, appeal))) * (0.9 + ((h >>> 9) % 25) / 100));
  const openDays = t.days ?? DEFAULT_DAYS[kind] ?? ALL_WEEK;
  return {
    name: buildName(kind, t.label, h),
    trade: t.label,
    openHour: t.open,
    closeHour: t.close,
    openDays,
    employees,
    dailyRent,
  };
}

/** Whether the business operates on the given weekday (0=Mon … 6=Sun). */
export function tenantOpenDay(tenant: Tenant, dayIndex: number): boolean {
  return (tenant.openDays ?? ALL_WEEK).includes(dayIndex);
}

/**
 * Whether a tenant is currently open for business: an operating day AND within
 * hours.
 */
export function tenantOpen(tenant: Tenant, hourF: number, dayIndex: number): boolean {
  return tenantOpenDay(tenant, dayIndex) && hourF >= tenant.openHour && hourF < tenant.closeHour;
}

/**
 * Whether a tenant's lights are on: only on operating days, from an hour before
 * opening to an hour after closing.
 */
export function tenantLit(tenant: Tenant, hourF: number, dayIndex: number): boolean {
  return tenantOpenDay(tenant, dayIndex) && hourF >= tenant.openHour - 1 && hourF < tenant.closeHour + 1;
}

const DAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Short label for a set of operating days, e.g. "Mon–Fri" or "Every day". */
export function daysLabel(openDays: number[]): string {
  const d = [...new Set(openDays)].sort((a, b) => a - b);
  if (d.length >= 7) return "Every day";
  if (d.length === 0) return "—";
  const contiguous = d.every((v, i) => i === 0 || v === d[i - 1] + 1);
  if (contiguous && d.length > 1) return `${DAY_ABBR[d[0]]}–${DAY_ABBR[d[d.length - 1]]}`;
  return d.map((i) => DAY_ABBR[i]).join(", ");
}

/** What to call the headcount in the UI for this kind. */
export function headcountLabel(kind: UnitKind): string {
  if (kind === "apartment") return "Residents";
  if (kind === "hotel") return "Guests";
  return "Employees";
}
