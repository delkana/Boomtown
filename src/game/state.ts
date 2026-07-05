import type { GameConfig, GameState, Plot } from "./types";

/**
 * State construction + (de)serialization.
 *
 * `createGameState` is the single source of truth for a fresh game. The server
 * (fake or real) calls this to seed a world; clients never build their own —
 * they receive a snapshot and `deserialize` it.
 */

export function createGameState(id: string, config: GameConfig): GameState {
  const plots: Record<number, Plot> = {};
  for (let i = 0; i < config.plotCount; i++) {
    plots[i] = { id: `${id}:plot:${i}`, index: i, ownerId: null, units: [] };
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
