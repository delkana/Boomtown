import type { GameState, Plot } from "./types";
import {
  NEIGHBOR_PLOTS_EACH_SIDE,
  PLOT_COLS,
  STARTING_MONEY,
} from "./constants";

/**
 * State construction + (de)serialization.
 *
 * `createInitialState` is the single source of truth for a fresh game. The
 * future server would call this to seed the world; clients would receive a
 * snapshot rather than constructing their own.
 */

/** Flavor names for the stubbed-out neighbor plots (future other players). */
const NEIGHBOR_NAMES = [
  "Vesta Corp",
  "Nakamura Holdings",
  "Rook & Vale",
  "Brightside Ltd",
  "Onyx Group",
  "Meridian Estates",
];

export function createInitialState(
  localPlayerId = "p1",
  localPlayerName = "You",
): GameState {
  const plots: Record<number, Plot> = {};

  // The player's home plot at index 0.
  plots[0] = {
    id: "plot:0",
    index: 0,
    ownerId: localPlayerId,
    ownerName: localPlayerName,
    units: [],
  };

  // Stubbed neighbor plots on both sides — placeholders for the shared city.
  for (let side = 1; side <= NEIGHBOR_PLOTS_EACH_SIDE; side++) {
    for (const index of [side, -side]) {
      const nameIdx = (Math.abs(index) - 1) % NEIGHBOR_NAMES.length;
      plots[index] = {
        id: `plot:${index}`,
        index,
        ownerId: null,
        ownerName: NEIGHBOR_NAMES[nameIdx],
        units: [],
      };
    }
  }

  return {
    tick: 0,
    localPlayerId,
    players: {
      [localPlayerId]: { id: localPlayerId, name: localPlayerName, money: STARTING_MONEY },
    },
    plots,
    nextUnitSeq: 1,
  };
}

/** Total column span of a plot (footprint). Handy for camera/layout math. */
export function plotWidthCols(): number {
  return PLOT_COLS;
}

/** Serialize to a snapshot string (what a server would broadcast). */
export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

/** Rehydrate a snapshot (what a client would apply on receipt). */
export function deserialize(snapshot: string): GameState {
  return JSON.parse(snapshot) as GameState;
}
