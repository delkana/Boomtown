import { describe, it, expect } from "vitest";
import { visitorChart } from "../src/ui/hud";
import type { Tenant } from "../src/game/types";

/** Minimal tenant stub — only the fields visitorChart reads. */
function tenant(over: Partial<Tenant> = {}): Tenant {
  return {
    name: "Sterling Grocers",
    subset: "convenience",
    trade: "Convenience Store",
    openHour: 6,
    closeHour: 24,
    openDays: [0, 1, 2, 3, 4, 5, 6],
    employees: 5,
    workers: [],
    appeal: 0.7,
    dailyRent: 1000,
    ...over,
  };
}

describe("visitorChart (inspector daily-visitor chart)", () => {
  it("renders nothing for a kind without visitors (e.g. office)", () => {
    expect(visitorChart("office", tenant())).toBe("");
    expect(visitorChart("apartment", tenant())).toBe("");
  });

  it("shows a friendly empty state before any day has been recorded", () => {
    const html = visitorChart("store", tenant({ visitors: [] }));
    expect(html).toContain("<details");
    expect(html).toContain("Daily shoppers");
    expect(html).toContain("No data yet");
    expect(html).not.toContain("vbar");
  });

  it("labels patrons per business kind", () => {
    expect(visitorChart("store", tenant({ visitors: [10] }))).toContain("Daily shoppers");
    expect(visitorChart("restaurant", tenant({ visitors: [10] }))).toContain("Daily diners");
    expect(visitorChart("medical", tenant({ visitors: [10] }))).toContain("Daily patients");
  });

  it("draws one bar per recent day, latest count and average in the summary", () => {
    const html = visitorChart("restaurant", tenant({ visitors: [40, 60, 50, 80] }));
    // One bar per day.
    expect((html.match(/vbar/g) ?? []).length).toBe(4);
    // Latest count (80) in the summary, plus an average (round(57.5) = 58).
    expect(html).toContain("Daily diners · 80");
    expect(html).toContain("avg 58");
    // Tallest bar (80) maps to the max height; a shorter day is shorter.
    expect(html).toContain('title="80 diners"');
    expect(html).toContain('title="40 diners"');
  });

  it("keeps only the last 10 days of bars", () => {
    const many = Array.from({ length: 20 }, (_, i) => i + 1); // 1..20
    const html = visitorChart("store", tenant({ visitors: many }));
    expect((html.match(/vbar/g) ?? []).length).toBe(10);
    expect(html).toContain("Daily shoppers · 20"); // today is the last value
  });
});
