import { hashString } from "./hash";

/**
 * Special "feature" plots — parts of the city that can't be claimed or built on:
 * a river crossing, a park, or an elevated highway. Each city gets a couple,
 * placed among the buildable lots. They occupy space in the strip (so towers
 * have gaps and character) and are the natural hook for future adjacency
 * effects (a park lifts neighbors; a highway is noisy).
 */
export type FeatureKind = "river" | "park" | "highway";

/**
 * Kinds that city generation may roll. "highway" is temporarily disabled (kept
 * in the type, renderer, and name pools so it can be switched back on by adding
 * it here) — cities currently get only rivers and parks.
 */
export const FEATURE_KINDS: FeatureKind[] = ["river", "park"];

/** Feature plots are a fixed ~6 tiles wide. */
export const FEATURE_COLS = 6;

/** How many feature plots each city gets. */
export const FEATURE_COUNT = 2;

/** Human-facing type label (shown under the plot). */
export function featureLabel(kind: FeatureKind): string {
  switch (kind) {
    case "river":
      return "River Crossing";
    case "park":
      return "Park";
    case "highway":
      return "Elevated Highway";
  }
}

const FEATURE_NAMES: Record<FeatureKind, string[]> = {
  river: ["Kessler River", "Vale River", "Ashford Crossing", "Marrow River", "Silverbrook Crossing", "Rushwater River"],
  park: ["Central Park", "Greenwood Park", "Liberty Gardens", "Meridian Commons", "Elm Park", "Concord Green"],
  highway: ["Route 9 Overpass", "The Interchange", "Skyway 7", "Transit Viaduct", "Grand Overpass", "Line 4 Flyover"],
};

/** Deterministic proper name for a feature (e.g. "Central Park"). */
export function featureName(kind: FeatureKind, seed: string): string {
  const pool = FEATURE_NAMES[kind];
  return pool[hashString(seed) % pool.length];
}

/** Deterministic feature type for a seed. */
export function featureKindFor(seed: string): FeatureKind {
  return FEATURE_KINDS[hashString(seed) % FEATURE_KINDS.length];
}
