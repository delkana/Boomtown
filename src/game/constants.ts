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

/** Lobby limits. */
export const MAX_PLAYERS_LIMIT = 20;
export const MIN_PLOTS = 3;
export const MAX_PLOTS = 40;

export interface UnitDef {
  kind: UnitKind;
  label: string;
  /** Toolbar hotkey. */
  hotkey: string;
  /** Footprint width in cells. */
  width: number;
  /** One-time build cost. */
  cost: number;
  /** Per-tick upkeep (always paid, even when empty). */
  upkeep: number;
  /** Per-tick income at full occupancy (0 for infrastructure). */
  incomeAtFull: number;
  /** How fast occupancy climbs per tick when serviced (0..1 delta). */
  fillRate: number;
  /** Fill color for placeholder art. */
  color: string;
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
    upkeep: 5,
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
    upkeep: 10,
    incomeAtFull: 120,
    fillRate: 0.08,
    color: "#5b8fb0",
  },
  apartment: {
    kind: "apartment",
    label: "Apartment",
    hotkey: "3",
    width: 2,
    cost: 2500,
    upkeep: 8,
    incomeAtFull: 90,
    fillRate: 0.05,
    color: "#7bab6e",
  },
  elevator: {
    kind: "elevator",
    label: "Elevator",
    hotkey: "4",
    width: 1,
    cost: 1500,
    upkeep: 4,
    incomeAtFull: 0,
    fillRate: 0,
    color: "#8a8f98",
  },
};

/** Ordered list for the toolbar. */
export const BUILD_ORDER: UnitKind[] = ["lobby", "office", "apartment", "elevator"];

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
