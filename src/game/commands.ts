import type { UnitKind } from "./types";

/**
 * Commands are player INTENTS. They are the single choke point through which
 * state ever changes (aside from the periodic tick).
 *
 * THIS IS THE MULTIPLAYER BOUNDARY.
 * --------------------------------
 * Single-player today:  input -> dispatch(cmd) -> reducer mutates local state.
 * Multiplayer later:    input -> send(cmd) over socket -> server reducer ->
 *                       server broadcasts new snapshot -> clients apply it.
 *
 * Because commands are plain serializable objects and the reducer is pure,
 * neither the reducer nor the tick need to change when the server appears —
 * only the transport around them (see src/net/*, stubbed in README).
 */

export type Command =
  | {
      type: "PLACE_UNIT";
      playerId: string;
      plotIndex: number;
      kind: UnitKind;
      col: number;
      row: number;
    }
  | {
      type: "SELL_UNIT";
      playerId: string;
      plotIndex: number;
      unitId: string;
    };

/** A function that accepts commands. Local dispatcher today; socket send later. */
export type Dispatch = (cmd: Command) => void;
