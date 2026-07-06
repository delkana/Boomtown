import { describe, it, expect } from "vitest";
import { visitCount, visitSchedule, activeVisits, isVisitorKind } from "../src/game/visitors";
import type { Tenant } from "../src/game/types";

function tenant(over: Partial<Tenant> = {}): Tenant {
  return {
    name: "Sterling Grocers",
    subset: "convenience",
    trade: "Convenience Store",
    openHour: 8,
    closeHour: 22,
    openDays: [0, 1, 2, 3, 4, 5, 6],
    employees: 5,
    workers: [],
    appeal: 0.7,
    dailyRent: 1000,
    ...over,
  };
}

describe("visitors: shared daily visit model", () => {
  it("only stores, restaurants and clinics draw counted visitors", () => {
    expect(isVisitorKind("store")).toBe(true);
    expect(isVisitorKind("restaurant")).toBe(true);
    expect(isVisitorKind("medical")).toBe(true);
    expect(isVisitorKind("office")).toBe(false);
    expect(isVisitorKind("apartment")).toBe(false);
    expect(isVisitorKind("hotel")).toBe(false);
    expect(visitCount("office", tenant(), "u", 3)).toBe(0);
  });

  it("counts zero on days the business is closed", () => {
    const t = tenant({ openDays: [0, 1, 2, 3, 4] }); // Mon–Fri
    expect(visitCount("store", t, "u", 5)).toBe(0); // Saturday
    expect(visitCount("store", t, "u", 6)).toBe(0); // Sunday
    expect(visitCount("store", t, "u", 0)).toBeGreaterThan(0); // Monday
  });

  it("is deterministic and rises with appeal", () => {
    const lo = visitCount("store", tenant({ appeal: 0.1 }), "shop1", 2);
    const hi = visitCount("store", tenant({ appeal: 0.95 }), "shop1", 2);
    expect(hi).toBeGreaterThan(lo);
    // Same inputs → same output.
    expect(visitCount("store", tenant({ appeal: 0.6 }), "shop1", 2)).toBe(
      visitCount("store", tenant({ appeal: 0.6 }), "shop1", 2),
    );
  });

  it("the schedule length equals the counted total, within open hours", () => {
    for (let day = 0; day < 7; day++) {
      const t = tenant();
      const sched = visitSchedule("restaurant", t, "eat1", day);
      expect(sched.length).toBe(visitCount("restaurant", t, "eat1", day));
      for (const v of sched) {
        expect(v.arrive).toBeGreaterThanOrEqual(t.openHour);
        expect(v.depart).toBeLessThanOrEqual(t.closeHour);
        expect(v.depart).toBeGreaterThan(v.arrive);
      }
    }
  });

  it("only a handful of visits overlap at any one moment", () => {
    const t = tenant();
    const sched = visitSchedule("store", t, "shop1", 2);
    expect(sched.length).toBeGreaterThan(20); // a busy day
    let maxConcurrent = 0;
    for (let h = t.openHour; h < t.closeHour; h += 0.25) {
      maxConcurrent = Math.max(maxConcurrent, activeVisits(sched, h).length);
    }
    // Spread across open hours with short dwell → renderable concurrency, not the full day's total.
    expect(maxConcurrent).toBeGreaterThan(0);
    expect(maxConcurrent).toBeLessThan(sched.length / 3);
  });
});
