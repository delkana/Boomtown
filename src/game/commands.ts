import type { UnitKind } from "./types";

/**
 * Commands are player INTENTS. They are the single choke point through which
 * state ever changes (aside from the periodic tick).
 *
 * THIS IS THE MULTIPLAYER BOUNDARY.
 * --------------------------------
 * The seam is now real, just short-circuited to a LOCAL server:
 *
 *   Client:  input -> connection.dispatch(cmd) -> [transport] -> server
 *   Server:  applyCommand(worldState, cmd) -> broadcast(serialize(state))
 *   Client:  onSnapshot(deserialize(snap)) -> render
 *
 * Today `[transport]` is a direct in-process call (src/net/localServer.ts). To
 * go networked, that transport becomes a WebSocket and NOTHING in this file,
 * the reducer, or the tick changes — commands are already plain serializable
 * objects and the reducer is already pure and authoritative.
 *
 * Every command carries `playerId`. Locally the client fills it from its
 * session; a real server would IGNORE the client-supplied value and derive the
 * acting player from the authenticated connection.
 */

export type Command =
  | {
      type: "CLAIM_PLOT";
      playerId: string;
      plotIndex: number;
    }
  | {
      type: "SET_SPEED";
      playerId: string;
      speed: number;
    }
  | {
      type: "PLACE_GIRDER";
      playerId: string;
      plotIndex: number;
      col: number;
      row: number;
    }
  | {
      type: "SELL_GIRDER";
      playerId: string;
      plotIndex: number;
      col: number;
      row: number;
    }
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
