import type { ColorOption } from "../game/constants";
import type { Command } from "../game/commands";
import type { GameState } from "../game/types";

/**
 * Wire protocol DTOs — the messages that cross the client/server boundary.
 *
 * These are transport-agnostic: the same shapes flow through the in-process
 * LocalServer today and would flow through a WebSocket unchanged. Keeping them
 * separate from GameState makes the boundary explicit.
 */

export type { ColorOption };

/** Lobby-level summary of a game (no full state — just what the browser needs). */
export interface GameSummary {
  id: string;
  cityName: string;
  archetype: string;
  playerCount: number;
  maxPlayers: number;
  plotCount: number;
  claimedPlots: number;
  hasPassword: boolean;
  /** Present players, for showing color dots and disabling taken colors. */
  players: { name: string; color: string }[];
}

/** Request to create a new game (and join it as the first player). */
export interface CreateGameConfig {
  cityName: string;
  archetype: string;
  background: string;
  plotCount: number;
  maxPlayers: number;
  /** Plaintext password or null. On a real server this would be sent over TLS and hashed. */
  password: string | null;
  playerName: string;
  /** Chosen color id from PLAYER_COLORS. */
  playerColor: string;
}

/** Request to join an existing game. */
export interface JoinRequest {
  gameId: string;
  playerName: string;
  /** Chosen color id from PLAYER_COLORS. */
  playerColor: string;
  password: string | null;
}

/**
 * Per-connection identity. This is what replaces the old `localPlayerId` field
 * on GameState — it belongs to the CLIENT, not the shared world.
 */
export interface PlayerSession {
  gameId: string;
  playerId: string;
  playerName: string;
  colorHex: string;
  /**
   * Secret reconnect token for THIS client. Lets the player rejoin the same
   * game (across refresh / reconnect) without re-picking name+color. Never
   * appears in shared GameState, so it isn't leaked to other players.
   */
  token: string;
}

/* ------------------------------------------------------------------ *
 * WebSocket wire protocol (used by RemoteServer <-> server/wsServer). *
 * The in-process LocalServer bypasses this and calls the directory    *
 * directly, but both go through the exact same GameDirectory logic.   *
 * ------------------------------------------------------------------ */

/** Messages the client sends to the server. */
export type ClientMsg =
  | { t: "create"; reqId: number; cfg: CreateGameConfig }
  | { t: "join"; reqId: number; req: JoinRequest }
  | { t: "reconnect"; reqId: number; gameId: string; token: string }
  | { t: "command"; cmd: Command }
  | { t: "leave" };

/** Messages the server sends to the client. */
export type ServerMsg =
  | { t: "directory"; games: GameSummary[] }
  | { t: "result"; reqId: number; ok: true; session: PlayerSession; state: GameState }
  | { t: "result"; reqId: number; ok: false; error: string }
  | { t: "snapshot"; state: GameState }
  | { t: "cmdError"; error: string };
