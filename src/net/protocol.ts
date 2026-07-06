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
  /** Nearer backdrop layer id (see src/game/backgrounds.ts). */
  backgroundNear: string;
  /** Distant backdrop layer id (see src/game/backgrounds.ts). */
  backgroundFar: string;
  /** City latitude in degrees (−66..66); drives day/night length. */
  latitude: number;
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

/* ------------------------------------------------------------------ *
 * Accounts (server-side only). A user has a password-protected login,   *
 * a session token that keeps them signed in, and a list of the games    *
 * they've joined so those follow them across devices.                   *
 * ------------------------------------------------------------------ */

/** The public-facing bits of a signed-in account. */
export interface Profile {
  username: string;
  displayName: string;
  /** Preferred player color id (see PLAYER_COLORS). */
  color: string;
  /** True for accounts on the server's admin allowlist — unlocks the admin page. */
  isAdmin?: boolean;
}

/** One game an account belongs to, with the reconnect token to re-enter it. */
export interface Membership {
  gameId: string;
  playerId: string;
  token: string;
  cityName: string;
}

/** Result of a register/login/resume attempt. */
export type AuthResult =
  | { ok: true; sessionToken: string; profile: Profile; memberships: Membership[] }
  | { ok: false; error: string };

/* ------------------------------------------------------------------ *
 * Admin console (admin accounts only). Every admin request carries the  *
 * caller's session token; the server verifies it belongs to an admin    *
 * account before doing anything, then returns a fresh snapshot.         *
 * ------------------------------------------------------------------ */

/** One account as shown in the admin console (never includes password data). */
export interface AdminAccountView {
  username: string;
  displayName: string;
  color: string;
  createdAt: number;
  isAdmin: boolean;
  banned: boolean;
  /** How many games this account belongs to. */
  gameCount: number;
}

/** One city as shown in the admin console. */
export interface AdminGameView {
  id: string;
  cityName: string;
  archetype: string;
  playerCount: number;
  plotCount: number;
  claimedPlots: number;
  /** Built-in demo cities re-seed on restart and can't be deleted. */
  isSeeded: boolean;
}

/** The full picture the admin console renders. */
export interface AdminSnapshot {
  accounts: AdminAccountView[];
  games: AdminGameView[];
}

/** An action an admin can perform from the console. */
export type AdminAction =
  | { kind: "list" }
  | { kind: "deleteGame"; gameId: string }
  | { kind: "banUser"; username: string }
  | { kind: "unbanUser"; username: string };

/** Result of an admin action — a refreshed snapshot, or a reason it was refused. */
export type AdminResult =
  | { ok: true; snapshot: AdminSnapshot }
  | { ok: false; error: string };

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
  | { t: "leave" }
  | { t: "register"; reqId: number; username: string; password: string; displayName: string; color: string }
  | { t: "login"; reqId: number; username: string; password: string }
  | { t: "resume"; reqId: number; sessionToken: string }
  | { t: "logout"; sessionToken: string }
  | { t: "adminAction"; reqId: number; sessionToken: string; action: AdminAction };

/** Messages the server sends to the client. */
export type ServerMsg =
  | { t: "directory"; games: GameSummary[] }
  | { t: "result"; reqId: number; ok: true; session: PlayerSession; state: GameState }
  | { t: "result"; reqId: number; ok: false; error: string }
  | { t: "auth"; reqId: number; result: AuthResult }
  | { t: "admin"; reqId: number; result: AdminResult }
  | { t: "snapshot"; state: GameState }
  | { t: "cmdError"; error: string };
