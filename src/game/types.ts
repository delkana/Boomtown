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
export type UnitKind =
  | "lobby"
  | "office"
  | "medical"
  | "apartment"
  | "store"
  | "restaurant"
  | "hotel"
  | "elevator";

/** A single structural-support cell (girder) in a tower's frame. */
export interface Girder {
  col: number;
  row: number;
  /**
   * Cosmetic facade style (see src/game/facades.ts). Drives how the girder is
   * drawn and the wall/window look of any room built on it. Optional for
   * backwards compatibility; absent = the default style.
   */
  style?: string;
}

/**
 * A moving elevator car inside a shaft (a vertical run of "elevator" units in
 * one column). A shaft is a "bank"; up to MAX_CARS_PER_SHAFT cars can share it.
 * Cars are what actually carry people — a shaft with no car services no floor.
 * `position` is the authoritative floor; the client smoothly animates each car
 * as it idles at `home` and answers passenger calls (see render/people.ts).
 */
export interface ElevatorCar {
  id: string;
  /** Column of the shaft this car runs in. */
  col: number;
  /** Current floor as a fractional row (interpolates while moving). */
  position: number;
  /**
   * The floor the car returns to and waits at when idle. Cars don't patrol —
   * they sit here until given a new home (or, later, a passenger call).
   */
  home: number;
  /** Which side the cabin door is on (cosmetic). Default "right". */
  doorSide?: "left" | "right";
}

/**
 * One person on a tenant's roster — an employee (office/shop/clinic/restaurant)
 * or an occupant (apartment resident / hotel guest). Generated with the tenant.
 */
export interface Worker {
  /** Full name, region-appropriate for the city (see src/game/names.ts). */
  name: string;
  /** Job title, e.g. "Software Engineer", "Managing Partner", or "Resident". */
  title: string;
  /** Daily wage cost (0 for residents/guests). */
  dailySalary: number;
  /** Weekdays this person works: 0 = Monday … 6 = Sunday. */
  days: number[];
  /** Shift start/end hours (0..24). */
  startHour: number;
  endHour: number;
  /** Hour their 1-hour lunch break starts (−1 if not applicable, e.g. residents). */
  lunchHour: number;
}

/**
 * A business/household occupying a revenue room. A room either has a tenant or
 * is vacant (dark). Generated deterministically when one moves in; see
 * src/game/tenants.ts. Rent is paid to the owner once a day, at midnight.
 */
export interface Tenant {
  /** Display name, e.g. "Halbrook & Vance" or "Sterling Bakery". */
  name: string;
  /** Business subtype id (drives furniture), e.g. "software", "law", "pizza". */
  subset: string;
  /** The trade/type label, e.g. "Law Offices", "Dental Clinic", "Pizzeria". */
  trade: string;
  /** Business open hour (0..23) and close hour (1..24). Lights follow these. */
  openHour: number;
  closeHour: number;
  /** Weekdays the business operates: 0 = Monday … 6 = Sunday. */
  openDays: number[];
  /** How many people work / live here (equals workers.length). */
  employees: number;
  /** The roster of people who work / live here (names, titles, shifts). */
  workers: Worker[];
  /** Rent paid to the plot owner each day at midnight. */
  dailyRent: number;
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
  /** 1 when the room has a tenant, 0 when vacant (kept for quick readouts). */
  occupancy: number;
  /** The current tenant, or null/undefined if the room is vacant. */
  tenant?: Tenant | null;
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
  /** Elevator cars travelling this plot's shafts (see ElevatorCar). */
  cars: ElevatorCar[];
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
  /** Nearer backdrop layer (skyline / oldtown / palms / firs / none). */
  backgroundNear: string;
  /** Distant backdrop layer (ocean / mountains / hills / open sky). */
  backgroundFar: string;
  /**
   * City latitude in degrees (−66..66). Drives how day and night lengths swing
   * through the seasons in the day/night cycle (see clock.ts `skyState`).
   */
  latitude: number;
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
