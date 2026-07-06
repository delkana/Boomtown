import { describe, it, expect } from "vitest";
import { createGameState, serialize, deserialize } from "../src/game/state";
import { applyCommand } from "../src/game/reducer";
import { advanceTick, projectedDailyNet } from "../src/game/tick";
import { propertyNameFor, archetype } from "../src/game/archetypes";
import { gameTime, daylightHours, skyState } from "../src/game/clock";
import { elevatorAccess, viewRating, noiseRating, footTraffic, roomSatisfaction } from "../src/game/heatmaps";
import { ELEVATOR_CAR_COST, GIRDER_BASE_COST, MAX_PLOT_COLS, MIN_PLOT_COLS, STARTING_MONEY, UNIT_DEFS } from "../src/game/constants";
import { claimCost, girderCost, plotBaseCost, undergroundMultiplier } from "../src/game/economy";
import { FEATURE_COLS, FEATURE_COUNT } from "../src/game/features";
import { servicedRows, elevatorRuns, stepCar, CAR_SPEED, MAX_CARS_PER_SHAFT } from "../src/game/elevator";
import { facadeById, DEFAULT_FACADE } from "../src/game/facades";
import { generateTenant, tenantLit, hasTrades } from "../src/game/tenants";
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
    backgroundNear: "skyline",
    backgroundFar: "mountains",
    latitude: 40,
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

describe("underground", () => {
  function owned(): GameState {
    const s = freshGame();
    s.players["p1"].money = 10_000_000;
    applyCommand(s, { type: "CLAIM_PLOT", playerId: "p1", plotIndex: 0 });
    return s;
  }
  const G = (s: GameState, col: number, row: number) =>
    applyCommand(s, { type: "PLACE_GIRDER", playerId: "p1", plotIndex: 0, col, row });

  it("excavates down from the surface; row -1 hangs from the ground", () => {
    const s = owned();
    expect(G(s, 0, -1).ok).toBe(true); // hangs from the surface
    expect(G(s, 1, -3).ok).toBe(false); // nothing above it
    expect(G(s, 0, -2).ok).toBe(true); // supported by (0,-1) above
  });

  it("costs an extra 100% per level down", () => {
    expect(girderCost(-1)).toBe(GIRDER_BASE_COST * 2);
    expect(girderCost(-6)).toBe(GIRDER_BASE_COST * 7);
    expect(undergroundMultiplier(-2)).toBe(3);
    expect(undergroundMultiplier(3)).toBe(1);
  });

  it("reserves the 7th level below ground for the subway", () => {
    const s = owned();
    for (let r = -1; r >= -6; r--) expect(G(s, 0, r).ok).toBe(true);
    expect(G(s, 0, -7).ok).toBe(false); // subway level is off-limits
  });

  it("has no view underground", () => {
    const s = owned();
    for (let r = -1; r >= -3; r--) G(s, 0, r);
    expect(viewRating(s.plots[0], 0, -2)).toBe(0);
  });
});

describe("feature spacing", () => {
  it("never spawns two features adjacent to one another", () => {
    for (const id of ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"]) {
      const s = createGameState(id, {
        cityName: id, archetype: "pacifica", backgroundNear: "skyline", backgroundFar: "mountains",
        latitude: 40, plotCount: 10, maxPlayers: 4, hasPassword: false,
      });
      const feats = Object.values(s.plots).filter((p) => p.feature).map((p) => p.index).sort((a, b) => a - b);
      expect(feats).toHaveLength(2);
      expect(feats[1] - feats[0]).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("destroy rules", () => {
  it("can't split an elevator shaft — must remove from the top down", () => {
    const s = freshGame();
    s.players["p1"].money = 1_000_000;
    applyCommand(s, { type: "CLAIM_PLOT", playerId: "p1", plotIndex: 0 });
    frame(s, "p1", 0, [[0, 0], [1, 0], [2, 1]]);
    applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "lobby", col: 0, row: 0 });
    applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "elevator", col: 2, row: 0 });
    applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "elevator", col: 2, row: 1 });
    const bottom = s.plots[0].units.find((u) => u.kind === "elevator" && u.row === 0)!;
    const top = s.plots[0].units.find((u) => u.kind === "elevator" && u.row === 1)!;

    expect(applyCommand(s, { type: "SELL_UNIT", playerId: "p1", plotIndex: 0, unitId: bottom.id }).ok).toBe(false);
    expect(applyCommand(s, { type: "SELL_UNIT", playerId: "p1", plotIndex: 0, unitId: top.id }).ok).toBe(true);
    // With the top gone, the bottom can be removed.
    expect(applyCommand(s, { type: "SELL_UNIT", playerId: "p1", plotIndex: 0, unitId: bottom.id }).ok).toBe(true);
  });
});

describe("advanceTick economy", () => {
  function servicedTower(): GameState {
    const s = freshGame();
    s.players["p1"].money = 1_000_000;
    applyCommand(s, { type: "CLAIM_PLOT", playerId: "p1", plotIndex: 0 });
    frame(s, "p1", 0, [[0, 0], [1, 0], [2, 0], [4, 0], [5, 0]]);
    applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "lobby", col: 0, row: 0 });
    // The elevator shaft auto-buys its first car, so this floor is serviced.
    applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "elevator", col: 2, row: 0 });
    applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "office", col: 4, row: 0 });
    return s;
  }

  it("increments the tick counter", () => {
    const s = freshGame();
    advanceTick(s);
    expect(s.tick).toBe(1);
  });

  it("a serviced, appealing office eventually leases to a tenant", () => {
    const s = servicedTower();
    const office = s.plots[0].units.find((u) => u.kind === "office")!;
    expect(roomSatisfaction(s.plots[0], office)).toBeGreaterThan(0);
    expect(office.tenant).toBeFalsy(); // starts vacant
    for (let i = 0; i < 400; i++) advanceTick(s);
    expect(office.tenant).toBeTruthy();
    expect(office.occupancy).toBe(1);
    expect(office.tenant!.dailyRent).toBeGreaterThan(0);
  });

  it("a tenant leaves when its floor loses elevator service", () => {
    const s = servicedTower();
    const office = s.plots[0].units.find((u) => u.kind === "office")!;
    for (let i = 0; i < 400; i++) advanceTick(s);
    expect(office.tenant).toBeTruthy();
    // Remove the elevator so row 0 is no longer served → the tenant leaves.
    const elevator = s.plots[0].units.find((u) => u.kind === "elevator")!;
    applyCommand(s, { type: "SELL_UNIT", playerId: "p1", plotIndex: 0, unitId: elevator.id });
    advanceTick(s);
    expect(office.tenant).toBeFalsy();
  });

  it("projectedDailyNet is negative when vacant, positive once leased", () => {
    const s = servicedTower();
    expect(projectedDailyNet(s.plots[0])).toBeLessThan(0); // vacant → only upkeep
    for (let i = 0; i < 400; i++) advanceTick(s);
    expect(projectedDailyNet(s.plots[0])).toBeGreaterThan(0);
  });

  it("collects rent only at midnight (start of each day)", () => {
    const s = servicedTower();
    for (let i = 0; i < 400; i++) advanceTick(s); // lease up
    const office = s.plots[0].units.find((u) => u.kind === "office")!;
    expect(office.tenant).toBeTruthy();
    // Advance to just before the next midnight, tracking money changes.
    const TICKS_PER_DAY = (24 * 60) / 5;
    while (s.tick % TICKS_PER_DAY !== TICKS_PER_DAY - 1) advanceTick(s);
    const before = s.players["p1"].money;
    advanceTick(s); // crosses midnight
    expect(s.players["p1"].money).toBe(before + projectedDailyNet(s.plots[0]));
  });

  it("does not simulate unowned plots", () => {
    const s = freshGame();
    const moneyBefore = s.players["p1"].money;
    advanceTick(s);
    expect(s.players["p1"].money).toBe(moneyBefore);
  });
});

describe("room types & preferences", () => {
  it("defines the new room widths (store 3, restaurant 4, hotel 1, medical 3)", () => {
    expect(UNIT_DEFS.store.width).toBe(3);
    expect(UNIT_DEFS.restaurant.width).toBe(4);
    expect(UNIT_DEFS.hotel.width).toBe(1);
    expect(UNIT_DEFS.medical.width).toBe(3);
    for (const k of ["store", "restaurant", "hotel", "medical"] as const) {
      expect(UNIT_DEFS[k].incomeAtFull).toBeGreaterThan(0); // they earn revenue
    }
  });

  it("a medical office cares about access/view/quiet but not foot traffic", () => {
    const p = UNIT_DEFS.medical.prefs!;
    expect(p.elevator).toBeGreaterThan(0);
    expect(p.view).toBeGreaterThan(0);
    expect(p.noise).toBeGreaterThan(0);
    expect(p.foot ?? 0).toBe(0);
  });

  it("places a 3-wide store and a 4-wide restaurant over girders", () => {
    const s = freshGame(6, "pacifica");
    s.players["p1"].money = 1_000_000;
    applyCommand(s, { type: "CLAIM_PLOT", playerId: "p1", plotIndex: 0 });
    // Ground frame wide enough: lobby(0-1) + store(2-4) needs cols 0..4.
    frame(s, "p1", 0, [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]);
    applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "lobby", col: 0, row: 0 });
    const r = applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "store", col: 2, row: 0 });
    expect(r.ok).toBe(true);
    expect(s.plots[0].units.find((u) => u.kind === "store")!.width).toBe(3);
  });

  it("a store prefers foot traffic: busier spot => higher appeal", () => {
    // Build a plot with a lobby + elevator, then compare a store on the busy
    // ground floor (foot traffic 100) with the same store up an empty floor.
    const s = freshGame(6, "pacifica");
    s.players["p1"].money = 1_000_000;
    applyCommand(s, { type: "CLAIM_PLOT", playerId: "p1", plotIndex: 0 });
    frame(s, "p1", 0, [[6, 3]]); // elevator column up to row 3
    frame(s, "p1", 0, [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]);
    frame(s, "p1", 0, [[2, 3], [3, 3], [4, 3]]);
    applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "lobby", col: 0, row: 0 });
    for (let r = 0; r <= 3; r++)
      applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "elevator", col: 6, row: r });

    const plot = s.plots[0];
    const ground = { id: "g", kind: "store" as const, col: 2, row: 0, width: 3, occupancy: 0 };
    const upstairs = { id: "u", kind: "store" as const, col: 2, row: 3, width: 3, occupancy: 0 };
    expect(roomSatisfaction(plot, ground)).toBeGreaterThan(roomSatisfaction(plot, upstairs));
  });

  it("an apartment prefers calm: it dislikes a noisy ground floor next to a lobby", () => {
    const s = freshGame(6, "pacifica");
    s.players["p1"].money = 1_000_000;
    applyCommand(s, { type: "CLAIM_PLOT", playerId: "p1", plotIndex: 0 });
    frame(s, "p1", 0, [[0, 0], [1, 0], [2, 0], [3, 0]]);
    applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "lobby", col: 0, row: 0 });
    const plot = s.plots[0];
    const nextToLobby = { id: "a", kind: "apartment" as const, col: 2, row: 0, width: 2, occupancy: 0 };
    // An apartment jammed onto the noisy ground floor should be well under ideal.
    expect(roomSatisfaction(plot, nextToLobby)).toBeLessThan(0.7);
  });
});

describe("elevator cars", () => {
  /** Owned plot with a lobby and an elevator shaft up to `top`, no cars yet. */
  function shaftTower(top = 3): GameState {
    const s = freshGame();
    s.players["p1"].money = 1_000_000;
    applyCommand(s, { type: "CLAIM_PLOT", playerId: "p1", plotIndex: 0 });
    frame(s, "p1", 0, [[0, 0], [1, 0], [4, 0], [5, 0]]);
    frame(s, "p1", 0, [[2, top]]); // girders up the shaft column
    applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "lobby", col: 0, row: 0 });
    for (let r = 0; r <= top; r++)
      applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "elevator", col: 2, row: r });
    applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "office", col: 4, row: 0 });
    return s;
  }

  it("a new elevator shaft auto-buys its first car and charges for both", () => {
    const s = freshGame();
    s.players["p1"].money = 1_000_000;
    applyCommand(s, { type: "CLAIM_PLOT", playerId: "p1", plotIndex: 0 });
    frame(s, "p1", 0, [[0, 0], [1, 0], [2, 0]]);
    applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "lobby", col: 0, row: 0 });
    const before = s.players["p1"].money;
    const r = applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "elevator", col: 2, row: 0 });
    expect(r.ok).toBe(true);
    expect(s.plots[0].cars).toHaveLength(1); // bundled first car
    expect(before - s.players["p1"].money).toBe(UNIT_DEFS.elevator.cost + ELEVATOR_CAR_COST);
  });

  it("extending an existing shaft does not add another car", () => {
    const s = shaftTower(3); // a 4-tall shaft
    expect(s.plots[0].cars).toHaveLength(1); // still just the one auto car
  });

  it("the auto car services the shaft's floors (so rooms can lease)", () => {
    const s = shaftTower(3);
    const rows = servicedRows(s.plots[0]);
    for (let f = 0; f <= 3; f++) expect(rows.has(f)).toBe(true);
    const office = s.plots[0].units.find((u) => u.kind === "office")!;
    for (let i = 0; i < 400; i++) advanceTick(s);
    expect(office.tenant).toBeTruthy();
  });

  it("a carless shaft (its car sold) services no floor", () => {
    const s = shaftTower(3);
    applyCommand(s, { type: "SELL_ELEVATOR_CAR", playerId: "p1", plotIndex: 0, col: 2, row: 0 });
    expect(s.plots[0].cars).toHaveLength(0);
    expect(servicedRows(s.plots[0]).size).toBe(0);
    const office = s.plots[0].units.find((u) => u.kind === "office")!;
    for (let i = 0; i < 400; i++) advanceTick(s);
    expect(office.tenant).toBeFalsy(); // never leases without service
  });

  it("rejects a car placed outside any shaft", () => {
    const s = shaftTower();
    const r = applyCommand(s, { type: "PLACE_ELEVATOR_CAR", playerId: "p1", plotIndex: 0, col: 4, row: 0 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/shaft/i);
  });

  it(`caps a shaft at ${MAX_CARS_PER_SHAFT} cars (incl. the auto car)`, () => {
    const s = shaftTower(3); // starts with 1 auto car
    for (let i = 1; i < MAX_CARS_PER_SHAFT; i++)
      expect(applyCommand(s, { type: "PLACE_ELEVATOR_CAR", playerId: "p1", plotIndex: 0, col: 2, row: 0 }).ok).toBe(true);
    expect(s.plots[0].cars).toHaveLength(MAX_CARS_PER_SHAFT);
    const overflow = applyCommand(s, { type: "PLACE_ELEVATOR_CAR", playerId: "p1", plotIndex: 0, col: 2, row: 0 });
    expect(overflow.ok).toBe(false);
  });

  it("cars accelerate, cruise, then brake to a smooth stop (stepCar)", () => {
    // From the ground, head to floor 4 (time-based motion, not tick-based).
    let st = stepCar(0, 0, 4, 0, 4, 0.25);
    expect(st.pos).toBeGreaterThan(0); // started moving up
    expect(st.vel).toBeGreaterThan(0); // and building speed
    const firstSpeed = st.vel;
    st = stepCar(st.pos, st.vel, 4, 0, 4, 0.25);
    expect(st.vel).toBeGreaterThan(firstSpeed); // still accelerating (momentum)
    let maxSpeed = 0;
    for (let i = 0; i < 400; i++) {
      st = stepCar(st.pos, st.vel, 4, 0, 4, 0.1);
      maxSpeed = Math.max(maxSpeed, st.vel);
      expect(st.pos).toBeGreaterThanOrEqual(0);
      expect(st.pos).toBeLessThanOrEqual(4);
    }
    expect(maxSpeed).toBeLessThanOrEqual(CAR_SPEED + 1e-6); // never exceeds top speed
    expect(st.pos).toBeCloseTo(4, 5); // reaches the target...
    expect(st.vel).toBe(0); // ...and comes to rest
    // A car already at its target stays put; target clamps to the shaft.
    expect(stepCar(2, 0, 2, 0, 4, 1).pos).toBe(2);
    expect(stepCar(2, 0, 2, 2, 2, 0.5).pos).toBe(2); // single-floor shaft
  });

  it("sets the shaft cars' idle home floor (clamped to the shaft)", () => {
    const s = shaftTower(4); // shaft floors 0..4, auto car idling at 0
    expect(s.plots[0].cars[0].home).toBe(0);
    const r = applyCommand(s, { type: "SET_CAR_HOME", playerId: "p1", plotIndex: 0, col: 2, home: 3 });
    expect(r.ok).toBe(true);
    expect(s.plots[0].cars[0].home).toBe(3);
    applyCommand(s, { type: "SET_CAR_HOME", playerId: "p1", plotIndex: 0, col: 2, home: 99 });
    expect(s.plots[0].cars[0].home).toBe(4); // clamped to the top floor
  });

  it("sets the shaft cars' cabin door side", () => {
    const s = shaftTower(4);
    const r = applyCommand(s, { type: "SET_CAR_DOOR", playerId: "p1", plotIndex: 0, col: 2, side: "left" });
    expect(r.ok).toBe(true);
    expect(s.plots[0].cars[0].doorSide).toBe("left");
    applyCommand(s, { type: "SET_CAR_DOOR", playerId: "p1", plotIndex: 0, col: 2, side: "right" });
    expect(s.plots[0].cars[0].doorSide).toBe("right");
  });

  it("removing the shaft prunes its now-orphaned car", () => {
    const s = shaftTower(0); // single-floor shaft with its auto car
    expect(s.plots[0].cars).toHaveLength(1);
    const elev = s.plots[0].units.find((u) => u.kind === "elevator")!;
    applyCommand(s, { type: "SELL_UNIT", playerId: "p1", plotIndex: 0, unitId: elev.id });
    expect(s.plots[0].cars).toHaveLength(0);
  });

  it("selling the car unservices the floors and refunds", () => {
    const s = shaftTower(2);
    const before = s.players["p1"].money;
    const r = applyCommand(s, { type: "SELL_ELEVATOR_CAR", playerId: "p1", plotIndex: 0, col: 2, row: 0 });
    expect(r.ok).toBe(true);
    expect(s.plots[0].cars).toHaveLength(0);
    expect(s.players["p1"].money).toBeGreaterThan(before);
    expect(servicedRows(s.plots[0]).size).toBe(0);
  });
});

describe("tenants", () => {
  it("generates a deterministic tenant for business kinds (none for infrastructure)", () => {
    const a = generateTenant("office", "plot:1:u3", 0.7, 2)!;
    const b = generateTenant("office", "plot:1:u3", 0.7, 2)!;
    expect(a).toEqual(b); // stable identity for a given seed
    expect(a.name).toBeTruthy();
    expect(a.trade).toBeTruthy();
    expect(a.employees).toBeGreaterThan(0);
    expect(a.dailyRent).toBeGreaterThan(0);
    expect(a.closeHour).toBeGreaterThan(a.openHour);
    expect(hasTrades("office")).toBe(true);
    expect(hasTrades("lobby")).toBe(false);
    expect(generateTenant("lobby", "x", 1, 2)).toBeNull();
  });

  it("a more appealing spot commands higher rent", () => {
    const lo = generateTenant("office", "seed", 0.1, 2)!;
    const hi = generateTenant("office", "seed", 0.9, 2)!;
    expect(hi.dailyRent).toBeGreaterThan(lo.dailyRent);
  });

  it("offices are small teams of 4–6 with a full staff roster", () => {
    for (let i = 0; i < 60; i++) {
      const t = generateTenant("office", `office:${i}`, 0.7, 2 + (i % 3))!;
      expect(t.employees).toBeGreaterThanOrEqual(4);
      expect(t.employees).toBeLessThanOrEqual(6);
      expect(t.workers).toHaveLength(t.employees); // roster matches the headcount
      // Each worker has a name, title, shift and work days.
      for (const w of t.workers) {
        expect(w.name).toContain(" "); // given + family
        expect(w.title).toBeTruthy();
        expect(w.dailySalary).toBeGreaterThan(0);
        expect(w.days).toEqual(t.openDays);
        expect(w.startHour).toBe(t.openHour);
        expect(w.endHour).toBe(t.closeHour);
      }
    }
  });

  it("names follow the city archetype (region-appropriate)", () => {
    const jp = generateTenant("office", "seed:jp", 0.7, 2, "japan")!;
    const su = generateTenant("office", "seed:jp", 0.7, 2, "ussr")!;
    // Same seed, different region → different name pools → different rosters.
    expect(jp.workers[0].name).not.toBe(su.workers[0].name);
    // Distinct people within a single office.
    const names = new Set(jp.workers.map((w) => w.name));
    expect(names.size).toBe(jp.workers.length);
  });

  it("assigns a subset from the kind's set and pulls from a large name pool", () => {
    const t = generateTenant("restaurant", "seed", 0.7, 4)!;
    expect(["mexican", "chinese", "pizza", "american", "sushi", "cafe"]).toContain(t.subset);
    // Many distinct names available per kind (100+ combinations across subsets).
    const names = new Set<string>();
    for (let i = 0; i < 300; i++) names.add(generateTenant("restaurant", `r:${i}`, 0.7, 4)!.name);
    expect(names.size).toBeGreaterThan(80);
  });

  it("lights are on from an hour before opening to an hour after closing", () => {
    const t = { name: "x", subset: "generic", trade: "y", openHour: 9, closeHour: 17, openDays: [0, 1, 2, 3, 4, 5, 6], employees: 5, dailyRent: 100 };
    expect(tenantLit(t, 8, 0)).toBe(true); // 1h before open
    expect(tenantLit(t, 13, 0)).toBe(true); // midday
    expect(tenantLit(t, 17.5, 0)).toBe(true); // within 1h after close
    expect(tenantLit(t, 19, 0)).toBe(false); // well after close
    expect(tenantLit(t, 6, 0)).toBe(false); // early morning
  });

  it("a weekday-only business is dark on the weekend", () => {
    const t = { name: "x", subset: "law", trade: "Law", openHour: 9, closeHour: 17, openDays: [0, 1, 2, 3, 4], employees: 5, dailyRent: 100 };
    expect(tenantLit(t, 13, 2)).toBe(true); // Wednesday
    expect(tenantLit(t, 13, 5)).toBe(false); // Saturday
    expect(tenantLit(t, 13, 6)).toBe(false); // Sunday
    // Generated office tenants get a valid subset + operating days.
    const g = generateTenant("office", "seed:x", 0.7, 2)!;
    expect(g.subset).toBeTruthy();
    expect(g.openDays.length).toBeGreaterThan(0);
  });
});

describe("girder facades (cosmetic)", () => {
  it("stores a valid facade style on the girder and ignores invalid ids", () => {
    const s = freshGame();
    s.players["p1"].money = 1_000_000;
    applyCommand(s, { type: "CLAIM_PLOT", playerId: "p1", plotIndex: 0 });
    applyCommand(s, { type: "PLACE_GIRDER", playerId: "p1", plotIndex: 0, col: 0, row: 0, style: "brick" });
    applyCommand(s, { type: "PLACE_GIRDER", playerId: "p1", plotIndex: 0, col: 1, row: 0, style: "not-real" });
    applyCommand(s, { type: "PLACE_GIRDER", playerId: "p1", plotIndex: 0, col: 2, row: 0 });
    const g = (c: number) => s.plots[0].girders.find((gg) => gg.col === c && gg.row === 0)!;
    expect(g(0).style).toBe("brick");
    expect(g(1).style).toBeUndefined(); // invalid → left unset (renders as default)
    expect(g(2).style).toBeUndefined();
    // Unset styles resolve to the default facade.
    expect(facadeById(g(2).style).id).toBe(DEFAULT_FACADE);
    expect(facadeById(g(0).style).id).toBe("brick");
  });
});

describe("day/night by latitude", () => {
  const JUNE = 2016 * 5; // ~5 months in: high sun in the north
  const DECEMBER = 2016 * 11; // ~11 months in: low sun in the north

  it("keeps ~12h days near the equator year-round", () => {
    expect(daylightHours(0, JUNE)).toBeCloseTo(12, 1);
    expect(daylightHours(0, DECEMBER)).toBeCloseTo(12, 1);
  });

  it("gives high latitudes long summer days and short winter days", () => {
    const summer = daylightHours(60, JUNE);
    const winter = daylightHours(60, DECEMBER);
    expect(summer).toBeGreaterThan(14);
    expect(winter).toBeLessThan(10);
    expect(summer).toBeGreaterThan(winter);
  });

  it("mirrors the seasons across the hemispheres", () => {
    // Northern summer is southern winter at the same tick.
    expect(daylightHours(50, JUNE)).toBeGreaterThan(daylightHours(-50, JUNE));
  });

  it("skyState is dark at local midnight and bright at local noon", () => {
    const noon = skyState(144, 40); // 12:00
    const midnight = skyState(0, 40); // 00:00
    expect(noon.day).toBeGreaterThan(midnight.day);
    expect(midnight.day).toBe(0);
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
  it("only accepts the offered speeds (1,2,3,5,10)", () => {
    const s = freshGame();
    expect(s.speed).toBe(1);
    expect(applyCommand(s, { type: "SET_SPEED", playerId: "p1", speed: 10 }).ok).toBe(true);
    expect(s.speed).toBe(10);
    expect(applyCommand(s, { type: "SET_SPEED", playerId: "p1", speed: 4 }).ok).toBe(false);
    expect(s.speed).toBe(10); // 4× is no longer an option
  });
});

describe("game clock", () => {
  const TICKS_PER_DAY = (24 * 60) / 5; // 288
  const TICKS_PER_WEEK = TICKS_PER_DAY * 7; // 2016 (one week == one month)

  it("starts at Year 1, Jan, Monday 12:00 AM", () => {
    expect(gameTime(0)).toMatchObject({
      year: 1, month: 1, monthName: "Jan", dayFull: "Monday", time12: "12:00 AM",
    });
  });

  it("labels year-first with full month, full weekday, and AM/PM time", () => {
    expect(gameTime(0).label).toBe("Year 1 · January · Monday · 12:00 AM");
  });

  it("formats time in 12-hour AM/PM", () => {
    expect(gameTime(144).time12).toBe("12:00 PM"); // noon
    expect(gameTime(163).time12).toBe("1:35 PM"); // 13:35
    expect(gameTime(6).time12).toBe("12:30 AM"); // 00:30
  });

  it("advances 5 in-game minutes per tick", () => {
    expect(gameTime(1).time).toBe("00:05");
    expect(gameTime(12).time).toBe("01:00");
  });

  it("treats a week as a month and 12 months as a year", () => {
    expect(gameTime(TICKS_PER_DAY).dayName).toBe("Tue");
    expect(gameTime(TICKS_PER_WEEK)).toMatchObject({ month: 2, monthName: "Feb", year: 1, dayName: "Mon" });
    expect(gameTime(TICKS_PER_WEEK * 12).year).toBe(2);
  });
});

describe("heatmaps", () => {
  function tower(): GameState {
    const s = freshGame();
    s.players["p1"].money = 1_000_000;
    applyCommand(s, { type: "CLAIM_PLOT", playerId: "p1", plotIndex: 0 });
    frame(s, "p1", 0, [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [4, 0]]);
    applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "lobby", col: 0, row: 0 });
    applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "elevator", col: 2, row: 0 });
    applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "elevator", col: 2, row: 1 });
    applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "elevator", col: 2, row: 2 });
    return s;
  }

  it("elevator access is a non-issue on the ground and falls off with distance", () => {
    const p = tower().plots[0];
    expect(elevatorAccess(p, 10, 0)).toBe(100); // ground floor always fine
    expect(elevatorAccess(p, 2, 1)).toBe(100); // on the shaft
    expect(elevatorAccess(p, 8, 1)).toBeCloseTo(100 * (1 - 6 / 12), 5); // 6 tiles away
    expect(elevatorAccess(p, 15, 1)).toBe(0); // >12 tiles away
  });

  it("view rises with height and open air, and counts a below-overhang", () => {
    const p = tower().plots[0];
    // Higher is better.
    expect(viewRating(p, 6, 5)).toBeGreaterThan(viewRating(p, 6, 1));
    // An isolated high tile is open on all four sides (incl. below = overhang).
    expect(viewRating(p, 6, 5)).toBe(5 + 20 * 4);
    // A ground tile gets no credit for the ground below it.
    expect(viewRating(p, 6, 0)).toBe(0 + 20 * 3); // left, right, above only
  });

  it("noise is higher near the ground and near noisy units", () => {
    const p = tower().plots[0];
    expect(noiseRating(p, 2, 0)).toBeGreaterThan(noiseRating(p, 6, 6));
    // Right on the elevator is louder than far away on the same floor.
    expect(noiseRating(p, 2, 1)).toBeGreaterThan(noiseRating(p, 6, 8));
  });

  it("foot traffic peaks on the ground and near elevators, scaled by floor rooms", () => {
    const s = tower();
    s.players["p1"].money = 1_000_000;
    // Put two offices on floor 1 near the shaft.
    frame(s, "p1", 0, [[3, 1], [4, 1], [5, 1], [6, 1]]);
    applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "office", col: 3, row: 1 });
    applyCommand(s, { type: "PLACE_UNIT", playerId: "p1", plotIndex: 0, kind: "office", col: 5, row: 1 });
    const p = s.plots[0];
    expect(footTraffic(p, 10, 0)).toBe(100); // ground floor is always busiest
    // On floor 1, near the elevator beats far from it.
    expect(footTraffic(p, 3, 1)).toBeGreaterThan(footTraffic(p, 15, 1));
    // A floor with no rooms has no traffic.
    expect(footTraffic(p, 8, 8)).toBe(0);
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
