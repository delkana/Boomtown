import type { ColorOption } from "../game/constants";

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
}
