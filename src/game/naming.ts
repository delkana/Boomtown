import { hashString } from "./hash";
import type { Plot, Unit } from "./types";

/**
 * Hotel naming. A building's hotel identity now lives on its Hotel Front Desk
 * (one per building), and every hotel room in that building is numbered off it:
 * "<brand> room #<floor><n>", e.g. "Grand Plaza room #1522" for the 22nd room on
 * the 15th floor. Deterministic from the plot id so the whole building agrees.
 */
const HOTEL_BRANDS = [
  "Grand Plaza", "Crowne Regent", "Bluebird Inn", "Sunset Suites", "The Wellington",
  "Parkview Lodge", "Harborlight Hotel", "Emerald Court", "Maple Grand", "Stateline Inn",
  "Coronado Suites", "The Ashford", "Cedar Ridge Hotel", "Lakeshore Inn", "Regency House",
  "The Monarch", "Silverpine Lodge", "Beacon Hotel", "Camelot Suites", "The Fairmount",
];

/** The building's hotel brand — shared by its front desk and every room in it. */
export function hotelNameFor(plotId: string): string {
  return HOTEL_BRANDS[hashString(`${plotId}:hotel`) % HOTEL_BRANDS.length];
}

/**
 * The name to display for a unit. The front desk shows the hotel brand; each
 * hotel room shows "<brand> room #<floor><position-on-floor>". Everything else
 * falls back to its tenant's name (or null if vacant / not applicable).
 */
export function roomDisplayName(plot: Plot, unit: Unit): string | null {
  if (unit.kind === "frontdesk") return hotelNameFor(plot.id);
  if (unit.kind === "hotel") {
    const onFloor = plot.units
      .filter((u) => u.kind === "hotel" && u.row === unit.row)
      .sort((a, b) => a.col - b.col);
    const n = onFloor.findIndex((u) => u.id === unit.id) + 1;
    return `${hotelNameFor(plot.id)} room #${unit.row}${n}`;
  }
  return unit.tenant?.name ?? null;
}
