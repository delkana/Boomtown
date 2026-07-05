import type { UnitKind } from "./types";

/**
 * Tunable game constants. Kept in one place so both the client and (future)
 * server share the exact same numbers — economy must be deterministic.
 */

/** Grid geometry, in world units (1 cell = CELL_SIZE px at zoom 1). */
export const CELL_SIZE = 48;
/** Columns per plot (tower footprint width). */
export const PLOT_COLS = 8;
/** Max floors above ground you can build. */
export const MAX_ROWS = 20;
/** Horizontal gap (in cells) between adjacent plots in the city strip. */
export const PLOT_GAP_COLS = 2;
/** How many stub neighbor plots to spawn on each side of the player. */
export const NEIGHBOR_PLOTS_EACH_SIDE = 3;

/** Player's starting cash. */
export const STARTING_MONEY = 20000;

/** Real seconds between economy ticks. */
export const TICK_SECONDS = 2;

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
