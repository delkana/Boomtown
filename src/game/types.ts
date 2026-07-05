/**
 * Core domain types for Boomtown.
 *
 * ARCHITECTURE NOTE
 * -----------------
 * Everything in `src/game/` is pure data + pure functions. It has NO reference
 * to the DOM, canvas, timers, or `window`. That is deliberate: this layer is
 * the "authoritative simulation" and is designed to run unchanged on a server
 * once we go multiplayer. See README.md ("Multiplayer boundary").
 *
 * The layer exposes:
 *   - State   : a plain serializable object (JSON-friendly)
 *   - Commands: player intents (see commands.ts)
 *   - reducer : applyCommand(state, cmd) -> mutates/returns state
 *   - tick    : advanceTick(state) -> advances the economy one step
 *
 * Rendering (src/render) and input (src/input) only READ state and PRODUCE
 * commands. They never mutate state directly.
 */

/** What kind of thing can occupy a grid cell on a tower floor. */
export type UnitKind = "lobby" | "office" | "apartment" | "elevator";

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
 * A plot is one parcel of land in the city strip. For the MVP only the player's
 * plot is buildable; the neighbors are stubs that represent other players'
 * future buildings.
 */
export interface Plot {
  id: string;
  /** Index along the city strip (…, -1, 0, +1, …). Player starts at 0. */
  index: number;
  /** Owner id. `null` = unclaimed/stub neighbor plot. */
  ownerId: string | null;
  /** Display name for the owner (stub flavor for neighbors). */
  ownerName: string;
  units: Unit[];
}

/** Per-player wallet + identity. In MVP there is exactly one local player. */
export interface Player {
  id: string;
  name: string;
  money: number;
}

/**
 * The complete authoritative game state. Fully serializable to JSON so it can
 * be snapshotted, sent over the wire, and rehydrated.
 */
export interface GameState {
  /** Monotonic tick counter (increments once per economy step). */
  tick: number;
  players: Record<string, Player>;
  /** Id of the local/acting player (server would derive this per-connection). */
  localPlayerId: string;
  /** All plots in the city strip, keyed by index for O(1) lookup. */
  plots: Record<number, Plot>;
  /** Counter used to mint unique unit ids deterministically. */
  nextUnitSeq: number;
}
