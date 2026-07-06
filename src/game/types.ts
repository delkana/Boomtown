/**
 * Core domain types for Boomtown.
 *
 * ARCHITECTURE NOTE
 * -----------------
 * Everything in `src/game/` is pure data + pure functions with NO reference to
 * the DOM, canvas, timers, or `window`. This layer is the authoritative
 * simulation and runs unchanged on the server. In this milestone it already
 * runs on a *local* fake server (`src/net/localServer.ts`); swapping that for a
 * real WebSocket server changes nothing in here. See README ("Multiplayer").
 *
 * Note what is NOT here: there is no `localPlayerId`. Which player a given
 * CLIENT is acting as is per-connection information (see PlayerSession in
 * src/net/protocol.ts), not part of the shared authoritative world.
 */

import type { FeatureKind } from "./features";

/** What kind of thing can occupy a grid cell on a tower floor. */
export type UnitKind = "lobby" | "office" | "apartment" | "elevator";

/** A single structural-support cell (girder) in a tower's frame. */
export interface Girder {
  col: number;
  row: number;
}

/** A single placed unit on a plot's tower grid. */
export interface Unit {
  id: string;
  kind: UnitKind;
  /** Grid column (x) within the plot, 0-based from the plot's left edge. */
  col: number;
  /** Grid row (floor). 0 is ground floor; higher = up. */
  row: number;
  /** How many cells wide the unit is. */
  width: number;
  /**
   * Tenant occupancy 0..1. Offices/apartments fill up over time once they are
   * connected to a lobby by an elevator. Purely simulation-side.
   */
  occupancy: number;
}

/**
 * A plot is one parcel of land in the shared city strip. Any player can claim
 * an unowned plot (CLAIM_PLOT); once owned, only the owner may build on it.
 */
export interface Plot {
  id: string;
  /** Index along the city strip, 0-based left to right. */
  index: number;
  /** Footprint width in grid columns (varies per plot, MIN..MAX_PLOT_COLS). */
  cols: number;
  /** Themed property name, e.g. "Redwood Spire" (or a feature name). */
  name: string;
  /**
   * If set, this is a non-buildable city feature (river/park/highway) rather
   * than a claimable lot. Feature plots can never be claimed or built on.
   */
  feature: FeatureKind | null;
  /** Owning player id, or `null` if the plot is unclaimed / for sale. */
  ownerId: string | null;
  /**
   * Structural frame: the cells that have girders. A room can only be placed
   * where girders already fill its footprint, so you build the skeleton first.
   */
  girders: Girder[];
  units: Unit[];
}

/** Per-player wallet + identity within a single game. */
export interface Player {
  id: string;
  name: string;
  /** Hex color chosen in the lobby; unique among a game's players. */
  color: string;
  money: number;
}

/** Immutable-ish game settings chosen by the creator in the lobby. */
export interface GameConfig {
  /** Display name of the city (also the basis for the game id). */
  cityName: string;
  /** City archetype id (theme/region), see src/game/archetypes.ts. */
  archetype: string;
  /** Backdrop drawn behind the buildings, see src/game/backgrounds.ts. */
  background: string;
  /** Number of plots in the city strip. */
  plotCount: number;
  /** Max concurrent players (hard-capped by MAX_PLAYERS_LIMIT). */
  maxPlayers: number;
  /** Whether a password is required to join (the password itself lives only on the server). */
  hasPassword: boolean;
}

/**
 * The complete authoritative game state for ONE game. Fully serializable to
 * JSON so it can be snapshotted, broadcast, and rehydrated by clients.
 */
export interface GameState {
  /** Game id (equals the city slug). */
  id: string;
  /** Monotonic tick counter (increments once per economy step). */
  tick: number;
  /** Game-speed multiplier (1..MAX_SPEED). Scales how fast real time -> ticks. */
  speed: number;
  config: GameConfig;
  players: Record<string, Player>;
  /** All plots in the city strip, keyed by index for O(1) lookup. */
  plots: Record<number, Plot>;
  /** Counter for minting unique unit ids deterministically. */
  nextUnitSeq: number;
  /** Counter for minting unique player ids deterministically. */
  nextPlayerSeq: number;
}
