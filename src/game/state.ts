import { MAX_PLOT_COLS, MIN_PLOT_COLS } from "./constants";
import type { GameConfig, GameState, Plot } from "./types";
import { propertyNameFor } from "./archetypes";

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
  let h = 2166136261;
  const key = `${gameId}:${index}`;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const span = MAX_PLOT_COLS - MIN_PLOT_COLS + 1;
  return MIN_PLOT_COLS + ((h >>> 0) % span);
}

export function createGameState(id: string, config: GameConfig): GameState {
  const plots: Record<number, Plot> = {};
  for (let i = 0; i < config.plotCount; i++) {
    plots[i] = {
      id: `${id}:plot:${i}`,
      index: i,
      cols: plotColsFor(id, i),
      name: propertyNameFor(config.archetype, i),
      ownerId: null,
      units: [],
    };
  }
  return {
    id,
    tick: 0,
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
