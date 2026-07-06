import type { UnitKind } from "./types";

/**
 * Tunable game constants. Kept in one place so the client and the (fake or
 * real) server share the exact same numbers — the economy must be deterministic.
 */

/** Grid geometry, in world units (1 cell = CELL_SIZE px at zoom 1). */
export const CELL_SIZE = 48;
/** Max floors above ground you can build. */
export const MAX_ROWS = 50;
/** How many basement levels you can excavate below ground (rows -1..-MAX_DEPTH). */
export const MAX_DEPTH = 6;
/** The reserved level (one below the deepest basement) held for a future subway. */
export const SUBWAY_ROW = -(MAX_DEPTH + 1);
/** Horizontal gap (in cells) between adjacent plots in the city strip. */
export const PLOT_GAP_COLS = 2;

/**
 * Plots vary in width. Each city plot gets a footprint between MIN and MAX
 * columns (chosen deterministically at city generation, see state.ts).
 */
export const MIN_PLOT_COLS = 7;
export const MAX_PLOT_COLS = 17;

/**
 * Base land price scales linearly with plot width: a MIN_PLOT_COLS plot costs
 * PLOT_COST_MIN, a MAX_PLOT_COLS plot costs PLOT_COST_MAX. The price a player
 * actually pays also multiplies by how many plots they already own (see
 * src/game/economy.ts).
 */
export const PLOT_COST_MIN = 4000;
export const PLOT_COST_MAX = 20000;

/**
 * Structural supports (girders). Each girder tile costs GIRDER_BASE_COST plus
 * GIRDER_COST_PER_FLOOR for every floor it sits above the ground.
 */
export const GIRDER_BASE_COST = 20;
export const GIRDER_COST_PER_FLOOR = 5;

/** Player's starting cash. */
export const STARTING_MONEY = 25000;

/** Real seconds between economy ticks at 1× speed (server-driven). */
export const TICK_SECONDS = 2;
/** In-game minutes that pass per tick. */
export const TICK_MINUTES = 5;
/** Selectable game-speed multipliers. */
export const SPEED_OPTIONS: readonly number[] = [1, 2, 3, 5, 10];
/** Calendar: a "month" is one week, and a year is this many months. */
export const DAYS_PER_WEEK = 7;
export const MONTHS_PER_YEAR = 12;
/** Economy ticks in one in-game day (rent is collected once per day). */
export const TICKS_PER_DAY = (24 * 60) / TICK_MINUTES;

/** Lobby limits. */
export const MAX_PLAYERS_LIMIT = 20;
export const MIN_PLOTS = 3;
export const MAX_PLOTS = 40;

/**
 * What a room "wants" from its location. Each factor is a signed weight: the
 * MAGNITUDE is how much the room cares (0 = indifferent), and the SIGN is the
 * desired direction, expressed against the same normalized 0..1 "goodness" the
 * heatmaps use (1 = high access / great view / quiet / busy):
 *   +  wants the good/high end (elevator, view, quiet, foot traffic)
 *   -  wants the opposite (e.g. LOW foot traffic for a quiet apartment)
 * See `roomSatisfaction` in heatmaps.ts.
 */
export interface RoomPrefs {
  elevator?: number;
  view?: number;
  /** Positive = prefers quiet (low noise). */
  noise?: number;
  /** Positive = prefers busy (high foot traffic); negative = prefers calm. */
  foot?: number;
}

export interface UnitDef {
  kind: UnitKind;
  label: string;
  /** Toolbar hotkey. */
  hotkey: string;
  /** Footprint width in cells. */
  width: number;
  /** One-time build cost. */
  cost: number;
  /** Daily upkeep, paid at midnight (always, even when vacant). */
  upkeep: number;
  /** Marks a revenue room (can hold a tenant) when > 0. Rent comes from tenants. */
  incomeAtFull: number;
  /** Legacy fill-rate (unused now tenants drive income). */
  fillRate: number;
  /** Fill color for placeholder art. */
  color: string;
  /**
   * Location preferences. Occupancy for a revenue room climbs toward how well
   * its spot satisfies these (its "appeal"), so placement matters. Omitted for
   * infrastructure (lobby / elevator), which have no tenants.
   */
  prefs?: RoomPrefs;
  /** Only one lobby allowed, and it must sit on the ground floor. */
  groundOnly?: boolean;
  unique?: boolean;
}

export const UNIT_DEFS: Record<UnitKind, UnitDef> = {
  lobby: {
    kind: "lobby",
    label: "Lobby",
    hotkey: "1",
    width: 2,
    cost: 2000,
    upkeep: 250,
    incomeAtFull: 0,
    fillRate: 0,
    color: "#c9a94f",
    groundOnly: true,
    unique: true,
  },
  office: {
    kind: "office",
    label: "Office",
    hotkey: "2",
    width: 2,
    cost: 3000,
    upkeep: 350,
    incomeAtFull: 120,
    fillRate: 0.08,
    color: "#5b8fb0",
    // Good elevator access + views; indifferent to noise and foot traffic.
    prefs: { elevator: 1.0, view: 0.7 },
  },
  medical: {
    kind: "medical",
    label: "Medical Office",
    hotkey: "3",
    width: 3,
    cost: 5000,
    upkeep: 400,
    incomeAtFull: 200,
    fillRate: 0.07,
    color: "#4bb5a6",
    // Clinics want easy access, a calm setting, and a pleasant outlook; foot
    // traffic doesn't matter (patients come by appointment).
    prefs: { elevator: 1.0, view: 0.6, noise: 0.8 },
  },
  apartment: {
    kind: "apartment",
    label: "Apartment",
    hotkey: "4",
    width: 2,
    cost: 2500,
    upkeep: 280,
    incomeAtFull: 90,
    fillRate: 0.05,
    color: "#7bab6e",
    // Quiet, low foot traffic, nice views, decent elevator access.
    prefs: { elevator: 0.7, view: 0.8, noise: 1.0, foot: -0.8 },
  },
  store: {
    kind: "store",
    label: "Store",
    hotkey: "5",
    width: 3,
    cost: 4500,
    upkeep: 320,
    incomeAtFull: 190,
    fillRate: 0.09,
    color: "#d08a4f",
    // Lives on footfall + easy access; doesn't care about views or noise.
    prefs: { elevator: 1.0, foot: 1.0 },
  },
  restaurant: {
    kind: "restaurant",
    label: "Restaurant",
    hotkey: "6",
    width: 4,
    cost: 6500,
    upkeep: 480,
    incomeAtFull: 280,
    fillRate: 0.08,
    color: "#c85a6a",
    // Wants footfall, access, and a view; noise is fine.
    prefs: { elevator: 1.0, view: 0.7, foot: 1.0 },
  },
  hotel: {
    kind: "hotel",
    label: "Hotel Room",
    hotkey: "7",
    width: 1,
    cost: 1800,
    upkeep: 160,
    incomeAtFull: 72,
    fillRate: 0.07,
    color: "#6a7fc0",
    // A quiet room with a view, good access, away from the bustle.
    prefs: { elevator: 0.9, view: 0.8, noise: 0.9, foot: -0.6 },
  },
  elevator: {
    kind: "elevator",
    label: "Elevator Shaft",
    hotkey: "8",
    width: 1,
    cost: 1500,
    upkeep: 220,
    incomeAtFull: 0,
    fillRate: 0,
    color: "#8a8f98",
  },
};

/** Ordered list for the toolbar. */
export const BUILD_ORDER: UnitKind[] = [
  "lobby",
  "office",
  "medical",
  "apartment",
  "store",
  "restaurant",
  "hotel",
  "elevator",
];

/**
 * Cost to install one elevator car in a shaft. Cars are what actually move
 * passengers (a shaft with no car can't service any floor); a shaft holds up to
 * MAX_CARS_PER_SHAFT of them (see src/game/elevator.ts).
 */
export const ELEVATOR_CAR_COST = 800;

/** A selectable player color for the lobby. */
export interface ColorOption {
  id: string;
  name: string;
  hex: string;
}

/**
 * 20 visually distinct player colors — one per max player, so color uniqueness
 * is always satisfiable even in a full 20-player game.
 */
export const PLAYER_COLORS: ColorOption[] = [
  { id: "crimson", name: "Crimson", hex: "#e0503f" },
  { id: "vermilion", name: "Vermilion", hex: "#e56a33" },
  { id: "amber", name: "Amber", hex: "#e79a2f" },
  { id: "gold", name: "Gold", hex: "#d9c23e" },
  { id: "chartreuse", name: "Chartreuse", hex: "#a6cf3c" },
  { id: "lime", name: "Lime", hex: "#77c33f" },
  { id: "emerald", name: "Emerald", hex: "#3fb96b" },
  { id: "jade", name: "Jade", hex: "#34c0a0" },
  { id: "teal", name: "Teal", hex: "#33b3bd" },
  { id: "cyan", name: "Cyan", hex: "#38a8e0" },
  { id: "azure", name: "Azure", hex: "#4a86e0" },
  { id: "indigo", name: "Indigo", hex: "#5b63e0" },
  { id: "violet", name: "Violet", hex: "#7d54e0" },
  { id: "purple", name: "Purple", hex: "#9d47d6" },
  { id: "magenta", name: "Magenta", hex: "#c94ad1" },
  { id: "fuchsia", name: "Fuchsia", hex: "#e04bab" },
  { id: "rose", name: "Rose", hex: "#e0577f" },
  { id: "coral", name: "Coral", hex: "#e07161" },
  { id: "slate", name: "Slate", hex: "#8792a6" },
  { id: "steel", name: "Steel", hex: "#6d7a99" },
];

export function colorHexById(id: string): string | undefined {
  return PLAYER_COLORS.find((c) => c.id === id)?.hex;
}
