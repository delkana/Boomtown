import { describe, it, expect } from "vitest";
import { createGameState, serialize, deserialize } from "../src/game/state";
import { applyCommand } from "../src/game/reducer";
import { advanceTick, projectedNet } from "../src/game/tick";
import { propertyNameFor, archetype } from "../src/game/archetypes";
import { gameTime } from "../src/game/clock";
import { MAX_PLOT_COLS, MIN_PLOT_COLS, STARTING_MONEY, UNIT_DEFS } from "../src/game/constants";
import { claimCost, girderCost, plotBaseCost } from "../src/game/economy";
import { FEATURE_COLS, FEATURE_COUNT } from "../src/game/features";
import type { GameState } from "../src/game/types";

/** Indices of the first `n` buildable (non-feature) plots. */
function buildable(s: GameState, n: number): number[] {
  return Object.values(s.plots)
    .filter((p) => !p.feature)
    .map((p) => p.index)
    .sort((a, b) => a - b)
    .slice(0, n);
}

/** Place girders up each listed [col,row] column from the ground to that row. */
function frame(s: GameState, playerId: string, plotIndex: number, cells: [number, number][]): void {
  for (const [col, row] of cells) {
    for (let r = 0; r <= row; r++) {
      applyCommand(s, { type: "PLACE_GIRDER", playerId, plotIndex, col, row: r });
    }
  }
}

/**
 * Tests for the pure simulation layer (src/game/*). This is the code that runs
 * identically on client and server, so it's the highest-value thing to lock
 * down — the whole multiplayer story rests on it being deterministic + correct.
 */

function freshGame(plotCount = 6, archetypeId = "pacifica"): GameState {
  const state = createGameState("test-city", {
    cityName: "Test City",
    archetype: archetypeId,
    plotCount,
    maxPlayers: 4,
    hasPassword: false,
  });
  // Register a player directly (the server does this via AuthoritativeGame).
  state.players["p1"] = { id: "p1", name: "Alice", color: "#e0503f", money: STARTING_MONEY };
  state.players["p2"] = { id: "p2", name: "Bob", color: "#4a86e0", money: STARTING_MONEY };
  return state;
}

describe("createGameState", () => {
  it("creates plotCount buildable lots plus the feature plots, all unowned", () => {
    const s = freshGame(9);
    expect(Object.keys(s.plots)).toHaveLength(9 + FEATURE_COUNT);
    const lots = Object.values(s.plots).filter((p) => !p.feature);
    expect(lots).toHaveLength(9);
    expect(Object.values(s.plots).every((p) => p.ownerId === null)).toBe(true);
  });

  it("gives each buildable lot a width within [MIN, MAX]_PLOT_COLS", () => {
    const s = freshGame(12);
    for (const p of Object.values(s.plots).filter((p) => !p.feature)) {
      expect(p.cols).toBeGreaterThanOrEqual(MIN_PLOT_COLS);
      expect(p.cols).toBeLessThanOrEqual(MAX_PLOT_COLS);
    }
  });

  it("assigns deterministic non-empty themed property names", () => {
    const a = freshGame(6, "japan");
    const b = freshGame(6, "japan");
    // Names are pure functions of (archetype, index): same inputs → same output.
    for (let i = 0; i < 6; i++) expect(a.plots[i].name).toBe(b.plots[i].name);
    expect(Object.values(a.plots).every((p) => p.name.trim().length > 0)).toBe(true);
  });
});

describe("CLAIM_PLOT", () => {
  it("claims an unowned plot and deducts the width-based cost", () => {
    const s = freshGame();
    const cost = claimCost(s, "p1", 0);
    expect(cost).toBe(plotBaseCost(s.plots[0].cols)); // first plot: ×1
    const r = applyCommand(s, { type: "CLAIM_PLOT", playerId: "p1", plotIndex: 0 });
    expect(r.ok).toBe(true);
    expect(s.plots[0].ownerId).toBe("p1");
    expect(s.players["p1"].money).toBe(STARTING_MONEY - cost);
  });

  it("charges escalating multiples for each additional plot (×1, ×2, ×3)", () => {
    const s = freshGame(8);
    s.players["p1"].money = 10_000_000; // enough for several
    const [a, b, c] = buildable(s, 3);
    expect(claimCost(s, "p1", a)).toBe(plotBaseCost(s.plots[a].cols) * 1);
    applyCommand(s, { type: "CLAIM_PLOT", playerId: "p1", plotIndex: a });
    expect(claimCost(s, "p1", b)).toBe(plotBaseCost(s.plots[b].cols) * 2);
    applyCommand(s, { type: "CLAIM_PLOT", playerId: "p1", plotIndex: b });
    expect(claimCost(s, "p1", c)).toBe(plotBaseCost(s.plots[c].cols) * 3);
  });

  it("prices land from PLOT_COST_MIN (narrow) up to PLOT_COST_MAX (wide)", () => {
    expect(plotBaseCost(MIN_PLOT_COLS)).toBe(4000);
    expect(plotBaseCost(MAX_PLOT_COLS)).toBe(20000);
    expect(plotBaseCost(MIN_PLOT_COLS + 1)).toBeGreaterThan(plotBaseCost(MIN_PLOT_COLS));
  });

  it("rejects claiming a plot you already own", () => {
    const s = freshGame();
    applyCommand(s, { type: "CLAIM_PLOT", playerId: "p1", plotIndex: 0 });
    const r = applyCommand(s, { type: "CLAIM_PLOT", playerId: "p1", plotIndex: 0 });
    expect(r.ok).toBe(false);
  });

  it("rejects claiming a plot owned by someone else", () => {
    const s = freshGame();
    applyCommand(s, { type: "CLAIM_PLOT", playerId: "p1", plotIndex: 0 });
    const r = applyCommand(s, { type: "CLAIM_PLOT", playerId: "p2", plotIndex: 0 });
    expect(r.ok).toBe(false);
    expect(s.plots[0].ownerId).toBe("p1");
  });

  it("rejects claiming without enough money", () => {
    const s = freshGame();
    s.players["p1"].money = claimCost(s, "p1", 0) - 1;
    const r = applyCommand(s, { type: "CLAIM_PLOT", playerId: "p1", plotIndex: 0 });
    expect(r.ok).toBe(false);
  });
});

describe("PLACE_UNIT", () => {
  function claimed(): GameState {
    const s = freshGame();
    s.players["p1"].money = 1_000_000; // plenty to build with, regardless of plot width
    applyCommand(s, { type: "CLAIM_PLOT", playerId: "p1", plotIndex: 0 });
    return s;
  }

  it("requires you to own the plot", () => {
    const s = claimed();
    const r = applyCommand(s, {
      type: "PLACE_UNIT", playerId: "p2", plotIndex: 0, kind: "lobby", col: 0, row: 0,
    });
    expect(r.ok).toBe(false);
  });

  it("requires a lobby before anything else", () => {
    const s = claimed();
    const r = applyCommand(s, {
      type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "office", col: 0, row: 0,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/lobby/i);
  });

  it("places a lobby on the ground (over girders) and charges for it", () => {
    const s = claimed();
    frame(s, "p1", 0, [[0, 0], [1, 0]]);
    const before = s.players["p1"].money;
    const r = applyCommand(s, {
      type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "lobby", col: 0, row: 0,
    });
    expect(r.ok).toBe(true);
    expect(s.plots[0].units).toHaveLength(1);
    expect(s.players["p1"].money).toBe(before - UNIT_DEFS.lobby.cost);
  });

  it("forbids a lobby off the ground floor", () => {
    const s = claimed();
    frame(s, "p1", 0, [[0, 3], [1, 3]]);
    const r = applyCommand(s, {
      type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "lobby", col: 0, row: 3,
    });
    expect(r.ok).toBe(false);
  });

  it("allows only one lobby", () => {
    const s = claimed();
    frame(s, "p1", 0, [[0, 0], [1, 0], [2, 0], [3, 0]]);
    applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "lobby", col: 0, row: 0 });
    const r = applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "lobby", col: 2, row: 0 });
    expect(r.ok).toBe(false);
  });

  it("rejects a room with no girders under it", () => {
    const s = claimed();
    frame(s, "p1", 0, [[0, 0], [1, 0]]);
    applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "lobby", col: 0, row: 0 });
    const r = applyCommand(s, {
      type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "office", col: 4, row: 3,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/girder|support/i);
  });

  it("rejects overlapping footprints", () => {
    const s = claimed();
    frame(s, "p1", 0, [[0, 0], [1, 0]]);
    applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "lobby", col: 0, row: 0 });
    // lobby is 2 wide at col 0 → col 1 is occupied
    const r = applyCommand(s, {
      type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "elevator", col: 1, row: 0,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects placement past the plot's right edge", () => {
    const s = claimed();
    frame(s, "p1", 0, [[0, 0], [1, 0]]);
    applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "lobby", col: 0, row: 0 });
    // office is 2 wide; placing it at (cols - 1) spills past the plot edge.
    const r = applyCommand(s, {
      type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "office", col: s.plots[0].cols - 1, row: 0,
    });
    expect(r.ok).toBe(false);
  });
});

describe("girders (structural supports)", () => {
  function owned(): GameState {
    const s = freshGame();
    s.players["p1"].money = 1_000_000;
    applyCommand(s, { type: "CLAIM_PLOT", playerId: "p1", plotIndex: 0 });
    return s;
  }

  it("cost is $20 + $5 per floor above the ground", () => {
    expect(girderCost(0)).toBe(20);
    expect(girderCost(1)).toBe(25);
    expect(girderCost(10)).toBe(70);
  });

  it("places a ground girder and deducts its cost", () => {
    const s = owned();
    const before = s.players["p1"].money;
    const r = applyCommand(s, { type: "PLACE_GIRDER", playerId: "p1", plotIndex: 0, col: 0, row: 0 });
    expect(r.ok).toBe(true);
    expect(s.plots[0].girders).toHaveLength(1);
    expect(s.players["p1"].money).toBe(before - 20);
  });

  it("needs the ground or a girder directly below", () => {
    const s = owned();
    expect(applyCommand(s, { type: "PLACE_GIRDER", playerId: "p1", plotIndex: 0, col: 0, row: 2 }).ok).toBe(false);
    applyCommand(s, { type: "PLACE_GIRDER", playerId: "p1", plotIndex: 0, col: 0, row: 0 });
    expect(applyCommand(s, { type: "PLACE_GIRDER", playerId: "p1", plotIndex: 0, col: 0, row: 1 }).ok).toBe(true);
  });

  it("allows a 1-tile overhang but not a 2-tile cantilever", () => {
    const s = owned();
    const G = (col: number, row: number) =>
      applyCommand(s, { type: "PLACE_GIRDER", playerId: "p1", plotIndex: 0, col, row });
    G(2, 0); // ground
    G(2, 1); // directly supported (girder below)
    expect(G(3, 1).ok).toBe(true); // 1-tile overhang off a directly-supported girder
    expect(G(4, 1).ok).toBe(false); // 2-tile: neighbor (3,1) is itself only an overhang
  });

  it("gates a room until its whole footprint is framed", () => {
    const s = owned();
    applyCommand(s, { type: "PLACE_GIRDER", playerId: "p1", plotIndex: 0, col: 0, row: 0 });
    const half = applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "lobby", col: 0, row: 0 });
    expect(half.ok).toBe(false); // lobby is 2 wide; only one cell framed
    applyCommand(s, { type: "PLACE_GIRDER", playerId: "p1", plotIndex: 0, col: 1, row: 0 });
    const full = applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "lobby", col: 0, row: 0 });
    expect(full.ok).toBe(true);
  });

  it("sells a bare girder but not one under a room or supporting another", () => {
    const s = owned();
    applyCommand(s, { type: "PLACE_GIRDER", playerId: "p1", plotIndex: 0, col: 0, row: 0 });
    applyCommand(s, { type: "PLACE_GIRDER", playerId: "p1", plotIndex: 0, col: 0, row: 1 });
    // (0,0) supports (0,1) → can't sell it yet.
    expect(applyCommand(s, { type: "SELL_GIRDER", playerId: "p1", plotIndex: 0, col: 0, row: 0 }).ok).toBe(false);
    // The top girder is free to sell.
    expect(applyCommand(s, { type: "SELL_GIRDER", playerId: "p1", plotIndex: 0, col: 0, row: 1 }).ok).toBe(true);
    // Put a lobby over (0,0)+(1,0); now (0,0) can't be sold (room on it).
    applyCommand(s, { type: "PLACE_GIRDER", playerId: "p1", plotIndex: 0, col: 1, row: 0 });
    applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "lobby", col: 0, row: 0 });
    expect(applyCommand(s, { type: "SELL_GIRDER", playerId: "p1", plotIndex: 0, col: 0, row: 0 }).ok).toBe(false);
  });
});

describe("SELL_UNIT", () => {
  it("removes the unit and refunds half", () => {
    const s = freshGame();
    applyCommand(s, { type: "CLAIM_PLOT", playerId: "p1", plotIndex: 0 });
    frame(s, "p1", 0, [[0, 0], [1, 0]]);
    applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "lobby", col: 0, row: 0 });
    const id = s.plots[0].units[0].id;
    const before = s.players["p1"].money;
    const r = applyCommand(s, { type: "SELL_UNIT", playerId: "p1", plotIndex: 0, unitId: id });
    expect(r.ok).toBe(true);
    expect(s.plots[0].units).toHaveLength(0);
    expect(s.players["p1"].money).toBe(before + Math.floor(UNIT_DEFS.lobby.cost * 0.5));
  });
});

describe("advanceTick economy", () => {
  function servicedTower(): GameState {
    const s = freshGame();
    s.players["p1"].money = 1_000_000;
    applyCommand(s, { type: "CLAIM_PLOT", playerId: "p1", plotIndex: 0 });
    frame(s, "p1", 0, [[0, 0], [1, 0], [2, 0], [4, 0], [5, 0]]);
    applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "lobby", col: 0, row: 0 });
    applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "elevator", col: 2, row: 0 });
    applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "office", col: 4, row: 0 });
    return s;
  }

  it("increments the tick counter", () => {
    const s = freshGame();
    advanceTick(s);
    expect(s.tick).toBe(1);
  });

  it("fills serviced offices toward full occupancy", () => {
    const s = servicedTower();
    const office = s.plots[0].units.find((u) => u.kind === "office")!;
    expect(office.occupancy).toBe(0);
    advanceTick(s);
    expect(office.occupancy).toBeCloseTo(UNIT_DEFS.office.fillRate, 5);
    for (let i = 0; i < 40; i++) advanceTick(s);
    expect(office.occupancy).toBe(1);
  });

  it("drains occupancy when the floor is unserviced (no elevator)", () => {
    const s = servicedTower();
    // Remove the elevator so row 0 is no longer served.
    const elevator = s.plots[0].units.find((u) => u.kind === "elevator")!;
    applyCommand(s, { type: "SELL_UNIT", playerId: "p1", plotIndex: 0, unitId: elevator.id });
    const office = s.plots[0].units.find((u) => u.kind === "office")!;
    office.occupancy = 0.5;
    advanceTick(s);
    expect(office.occupancy).toBeLessThan(0.5);
  });

  it("projectedNet is negative for infrastructure-only, positive once tenants arrive", () => {
    const s = servicedTower();
    expect(projectedNet(s.plots[0])).toBeLessThan(0); // occupancy 0 → only upkeep
    for (let i = 0; i < 40; i++) advanceTick(s);
    expect(projectedNet(s.plots[0])).toBeGreaterThan(0);
  });

  it("does not simulate unowned plots", () => {
    const s = freshGame();
    const moneyBefore = s.players["p1"].money;
    advanceTick(s);
    expect(s.players["p1"].money).toBe(moneyBefore);
  });
});

describe("feature plots", () => {
  function featureIndex(s: GameState): number {
    return Object.values(s.plots).find((p) => p.feature)!.index;
  }

  it("adds exactly FEATURE_COUNT non-buildable features, each FEATURE_COLS wide", () => {
    const s = freshGame(10);
    const features = Object.values(s.plots).filter((p) => p.feature);
    expect(features).toHaveLength(FEATURE_COUNT);
    expect(features.every((p) => p.cols === FEATURE_COLS)).toBe(true);
    expect(features.every((p) => ["river", "park", "highway"].includes(p.feature!))).toBe(true);
  });

  it("cannot be claimed", () => {
    const s = freshGame(10);
    const i = featureIndex(s);
    const r = applyCommand(s, { type: "CLAIM_PLOT", playerId: "p1", plotIndex: i });
    expect(r.ok).toBe(false);
    expect(s.plots[i].ownerId).toBeNull();
  });

  it("cannot be built on", () => {
    const s = freshGame(10);
    const i = featureIndex(s);
    const r = applyCommand(s, {
      type: "PLACE_UNIT", playerId: "p1", plotIndex: i, kind: "lobby", col: 0, row: 0,
    });
    expect(r.ok).toBe(false);
    expect(s.plots[i].units).toHaveLength(0);
  });

  it("is placed deterministically for a given game id", () => {
    const a = freshGame(10);
    const b = freshGame(10);
    const idsA = Object.values(a.plots).filter((p) => p.feature).map((p) => p.index);
    const idsB = Object.values(b.plots).filter((p) => p.feature).map((p) => p.index);
    expect(idsA).toEqual(idsB);
  });
});

describe("SET_SPEED", () => {
  it("sets a valid speed and rejects out-of-range values", () => {
    const s = freshGame();
    expect(s.speed).toBe(1);
    expect(applyCommand(s, { type: "SET_SPEED", playerId: "p1", speed: 3 }).ok).toBe(true);
    expect(s.speed).toBe(3);
    expect(applyCommand(s, { type: "SET_SPEED", playerId: "p1", speed: 9 }).ok).toBe(false);
    expect(s.speed).toBe(3); // unchanged after an invalid request
  });
});

describe("game clock", () => {
  const TICKS_PER_DAY = (24 * 60) / 5; // 288
  const TICKS_PER_WEEK = TICKS_PER_DAY * 7; // 2016 (one week == one month)

  it("starts at Year 1, Month 1, Monday 00:00", () => {
    expect(gameTime(0)).toMatchObject({ year: 1, month: 1, dayName: "Mon", time: "00:00" });
  });

  it("advances 5 in-game minutes per tick", () => {
    expect(gameTime(1).time).toBe("00:05");
    expect(gameTime(12).time).toBe("01:00");
  });

  it("treats a week as a month and 12 months as a year", () => {
    expect(gameTime(TICKS_PER_DAY).dayName).toBe("Tue");
    expect(gameTime(TICKS_PER_WEEK)).toMatchObject({ month: 2, year: 1, dayName: "Mon" });
    expect(gameTime(TICKS_PER_WEEK * 12).year).toBe(2);
  });
});

describe("archetypes", () => {
  it("propertyNameFor is deterministic and varied", () => {
    // Same (archetype, index) always yields the same name.
    expect(propertyNameFor("pacifica", 0)).toBe(propertyNameFor("pacifica", 0));
    expect(propertyNameFor("pacifica", 7)).toBe(propertyNameFor("pacifica", 7));
    // Across a run of plots it produces mostly-distinct names (not a constant).
    const names = new Set(Array.from({ length: 12 }, (_, i) => propertyNameFor("pacifica", i)));
    expect(names.size).toBeGreaterThan(6);
    expect([...names].every((n) => n.trim().length > 0)).toBe(true);
  });

  it("falls back to a default archetype for unknown ids", () => {
    expect(archetype("does-not-exist")).toBeDefined();
    expect(propertyNameFor("does-not-exist", 0)).toBeTruthy();
  });
});

describe("serialize / deserialize", () => {
  it("round-trips state losslessly", () => {
    const s = freshGame();
    applyCommand(s, { type: "CLAIM_PLOT", playerId: "p1", plotIndex: 0 });
    frame(s, "p1", 0, [[0, 0], [1, 0]]);
    applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "lobby", col: 0, row: 0 });
    advanceTick(s);
    const copy = deserialize(serialize(s));
    expect(copy).toEqual(s);
    // And it's a real copy, not a shared reference.
    copy.players["p1"].money = 0;
    expect(s.players["p1"].money).not.toBe(0);
  });
});
