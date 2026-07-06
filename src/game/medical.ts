import { buildingStars } from "./ratings";
import { hashString } from "./hash";
import type { GameState, Plot } from "./types";

/**
 * Walk-in medical demand. Every building draws patient groups through the day in
 * proportion to how nice it is (its star rating). Each group is after a random
 * specialty and will visit the nearest building — up to five — that has an open
 * clinic of that kind with a free appointment slot; if none does, they give up.
 * A patient who's seen pays the clinic's owner a $500 fee.
 *
 * Modeled as a deterministic daily settlement (server-authoritative): the exact
 * minute-by-minute wandering is cosmetic, but the appointments, the routing to
 * the nearest matching clinic, the per-clinic capacity and the fees are real.
 */

/** The medical specialties a patient group can be seeking (see tenants.ts SUBSETS.medical). */
export const MEDICAL_SUBSETS = ["primary", "dental", "optometry", "physio", "pediatrics", "dermatology"];

/** Patient groups a building attracts per day, indexed by round(stars * 2), 0..5 stars. */
const GROUPS_BY_HALFSTAR = [10, 20, 40, 60, 80, 100, 125, 150, 175, 200, 250];

/** Fee a clinic charges (and its owner earns) for a completed appointment. */
export const APPOINTMENT_FEE = 500;
/** Patients try this many of the nearest buildings before giving up. */
const MAX_BUILDINGS_TRIED = 5;

/** How many patient groups a building of the given star rating attracts in a day. */
export function patientGroupsForStars(stars: number): number {
  return GROUPS_BY_HALFSTAR[Math.max(0, Math.min(10, Math.round(stars * 2)))];
}

/** A clinic's daily appointment capacity: roughly two exam rooms, one patient/hour. */
function officeCapacity(open: number, close: number): number {
  return Math.max(4, Math.round((close - open) * 2));
}

/**
 * Settle one day of walk-in medical demand: credit each clinic owner $500 per
 * patient seen, and return the number of appointments each medical unit handled
 * (used for the inspector's daily-patient chart).
 */
export function runMedicalDay(state: GameState, day: number): Map<string, number> {
  const appointments = new Map<string, number>();
  // Buildings = owned plots with a lobby, ordered along the strip for nearest search.
  const buildings = Object.values(state.plots)
    .filter((p) => p.ownerId && p.units.some((u) => u.kind === "lobby"))
    .sort((a, b) => a.index - b.index);
  if (buildings.length === 0) return appointments;

  // Each leased clinic's remaining slots + its owner, for the day.
  const capacity = new Map<string, number>();
  const owner = new Map<string, string>();
  for (const p of buildings) {
    for (const u of p.units) {
      if (u.kind === "medical" && u.tenant) {
        capacity.set(u.id, officeCapacity(u.tenant.openHour, u.tenant.closeHour));
        owner.set(u.id, p.ownerId as string);
      }
    }
  }

  for (const p of buildings) {
    const groups = patientGroupsForStars(buildingStars(p));
    for (let g = 0; g < groups; g++) {
      const want = MEDICAL_SUBSETS[hashString(`${p.id}:pt:${day}:${g}`) % MEDICAL_SUBSETS.length];
      const seenAt = nearestMatchingOffice(buildings, p.index, want, capacity);
      if (!seenAt) continue; // no clinic within reach with a free slot → they give up
      capacity.set(seenAt, (capacity.get(seenAt) ?? 0) - 1);
      appointments.set(seenAt, (appointments.get(seenAt) ?? 0) + 1);
      const o = owner.get(seenAt);
      if (o && state.players[o]) state.players[o].money += APPOINTMENT_FEE;
    }
  }
  return appointments;
}

/** The nearest of the 5 closest buildings that has a matching clinic with a free slot. */
function nearestMatchingOffice(
  buildings: Plot[],
  fromIndex: number,
  wantSubset: string,
  capacity: Map<string, number>,
): string | null {
  const near = [...buildings]
    .sort((a, b) => Math.abs(a.index - fromIndex) - Math.abs(b.index - fromIndex))
    .slice(0, MAX_BUILDINGS_TRIED);
  for (const p of near) {
    for (const u of p.units) {
      if (u.kind === "medical" && u.tenant?.subset === wantSubset && (capacity.get(u.id) ?? 0) > 0) {
        return u.id;
      }
    }
  }
  return null;
}
