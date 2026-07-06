import { describe, it, expect } from "vitest";
import { PeopleSim } from "../src/render/people";
import { generateTenant } from "../src/game/tenants";
import type { GameState } from "../src/game/types";

/**
 * The client people-sim should render walking customers (shoppers/diners/
 * patients) for a business during its open hours, drawn from the shared visit
 * schedule — so what you see lines up with the charted daily count.
 */
function stateWithStore(): GameState {
  const tenant = generateTenant("store", "p0:u1", 0.85, 3, "pacifica")!;
  // Force an all-week, all-day shop so the test is time-robust.
  tenant.openDays = [0, 1, 2, 3, 4, 5, 6];
  tenant.openHour = 8;
  tenant.closeHour = 22;
  return {
    id: "g",
    tick: 0,
    speed: 1,
    config: {
      cityName: "T",
      archetype: "pacifica",
      backgroundNear: "none",
      backgroundFar: "clear",
      latitude: 40,
      plotCount: 1,
      maxPlayers: 1,
      hasPassword: false,
    },
    players: {},
    plots: {
      0: {
        id: "p0",
        index: 0,
        cols: 8,
        name: "",
        feature: null,
        ownerId: "me",
        girders: [],
        cars: [],
        units: [{ id: "u1", kind: "store", col: 2, row: 0, width: 3, occupancy: 1, tenant }],
      },
    },
    nextUnitSeq: 1,
    nextPlayerSeq: 1,
  } as unknown as GameState;
}

describe("people-sim: walking customers", () => {
  it("spawns named shoppers in an open store, distinct from staff", () => {
    const state = stateWithStore();
    const sim = new PeopleSim();
    const day = 2; // Wednesday
    const hour = 14; // mid-afternoon, store open
    const absHour = day * 24 + hour;
    // Advance a few seconds of animation (time frozen at 2pm) so customers walk in.
    for (let i = 0; i < 200; i++) sim.update(state, hour, day, absHour, 0.05);

    const people = sim.peopleIn(0);
    const shoppers = people.filter((p) => p.worker?.title === "Shopper");
    expect(shoppers.length).toBeGreaterThan(0); // customers are actually present
    // Capped for performance, even though the daily total is much larger.
    expect(shoppers.length).toBeLessThanOrEqual(12);
    for (const s of shoppers) {
      expect(s.worker?.name).toContain(" "); // a real given + family name
    }
  });

  it("has no customers before the store opens", () => {
    const state = stateWithStore();
    const sim = new PeopleSim();
    const day = 2;
    const hour = 5; // 5am, before the 8am open
    const absHour = day * 24 + hour;
    for (let i = 0; i < 50; i++) sim.update(state, hour, day, absHour, 0.05);
    const shoppers = sim.peopleIn(0).filter((p) => p.worker?.title === "Shopper");
    expect(shoppers.length).toBe(0);
  });
});
