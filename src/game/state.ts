import { MAX_PLOT_COLS, MIN_PLOT_COLS } from "./constants";
import type { GameConfig, GameState, Plot } from "./types";
import { propertyNameFor } from "./archetypes";
import { hashString } from "./hash";
import {
  FEATURE_COLS,
  FEATURE_COUNT,
  featureKindFor,
  featureName,
} from "./features";

/**
 * State construction + (de)serialization.
 *
 * `createGameState` is the single source of truth for a fresh game. The server
 * (fake or real) calls this to seed a world; clients never build their own —
 * they receive a snapshot and `deserialize` it.
 */

/**
 * Deterministic plot width (MIN..MAX_PLOT_COLS) from the game id + index. Being
 * a pure function of stable inputs keeps city generation reproducible (no
 * Math.random), so the server stays authoritative and tests are stable.
 */
export function plotColsFor(gameId: string, index: number): number {
  const span = MAX_PLOT_COLS - MIN_PLOT_COLS + 1;
  return MIN_PLOT_COLS + (hashString(`${gameId}:${index}`) % span);
}

/**
 * Pick FEATURE_COUNT distinct interior positions for the city's feature plots
 * (deterministic). Interior so features read as "cutting through" the city
 * rather than sitting on the edge.
 */
function featurePositions(id: string, total: number): Set<number> {
  const positions: number[] = [];
  const lo = 1;
  const hi = Math.max(lo, total - 2);
  const span = hi - lo + 1;
  for (let n = 0; positions.length < FEATURE_COUNT && n < 200; n++) {
    const p = lo + (hashString(`${id}:fpos:${n}`) % span);
    // Never place two features on the same tile OR adjacent to one another, so
    // no two features (and never two of the same kind) touch.
    if (positions.every((q) => Math.abs(q - p) >= 2)) positions.push(p);
  }
  return new Set(positions);
}

export function createGameState(id: string, config: GameConfig): GameState {
  const plots: Record<number, Plot> = {};
  // The creator's plot count is the number of BUILDABLE lots; feature plots are
  // added on top, interspersed through the strip.
  const total = config.plotCount + FEATURE_COUNT;
  const features = featurePositions(id, total);

  for (let i = 0; i < total; i++) {
    if (features.has(i)) {
      const kind = featureKindFor(`${id}:fkind:${i}`);
      plots[i] = {
        id: `${id}:plot:${i}`,
        index: i,
        cols: FEATURE_COLS,
        name: featureName(kind, `${id}:fname:${i}`),
        feature: kind,
        ownerId: null,
        girders: [],
        units: [],
        cars: [],
      };
    } else {
      plots[i] = {
        id: `${id}:plot:${i}`,
        index: i,
        cols: plotColsFor(id, i),
        name: propertyNameFor(config.archetype, i),
        feature: null,
        ownerId: null,
        girders: [],
        units: [],
        cars: [],
      };
    }
  }

  return {
    id,
    tick: 0,
    speed: 1,
    config,
    players: {},
    plots,
    nextUnitSeq: 1,
    nextPlayerSeq: 1,
  };
}

/** Serialize to a snapshot string (what a server broadcasts). */
export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

/** Rehydrate a snapshot (what a client applies on receipt). */
export function deserialize(snapshot: string): GameState {
  return JSON.parse(snapshot) as GameState;
}
