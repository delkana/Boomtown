import { describe, it, expect, beforeAll } from "vitest";
import { InputController } from "../src/input/input";
import { MAX_ROWS, MAX_DEPTH } from "../src/game/constants";

/**
 * The girder tool hijacks a press for drag-painting ONLY when the press starts
 * on a spot where a girder could actually be placed; anywhere else the press
 * pans the view. This tests that decision predicate (`canPlaceGirderAt`) so the
 * "let me still drag the screen on a dead spot" behavior can't regress.
 */

// InputController.attach() wires window keyboard listeners; stub them so the
// controller can be constructed in a plain (non-DOM) test environment.
beforeAll(() => {
  (globalThis as { window?: unknown }).window ??= {
    addEventListener() {},
    removeEventListener() {},
  };
});

type Cell = { plotIndex: number; col: number; row: number } | null;

function makeInput(plot: unknown, playerId = "me") {
  const canvas = { addEventListener() {}, removeEventListener() {} } as unknown as HTMLCanvasElement;
  const camera = {} as never;
  const conn = {
    session: { playerId, gameId: "g", token: "t", playerName: "P", colorHex: "#fff" },
    getState: () => ({ plots: { 0: plot }, players: { [playerId]: { money: 100000 } } }),
    dispatch() {},
    getState_unused: null,
  } as never;
  const noop = () => {};
  const input = new InputController(canvas, camera, conn, noop, noop, noop, () => null, noop);
  // canPlaceGirderAt is private; reach it directly for a focused unit test.
  return (cell: Cell) => (input as unknown as { canPlaceGirderAt(c: Cell): boolean }).canPlaceGirderAt(cell);
}

const buildable = (over: Record<string, unknown> = {}) => ({
  ownerId: "me",
  cols: 8,
  girders: [] as { col: number; row: number }[],
  feature: undefined,
  ...over,
});

describe("girder tool: paint-vs-pan placement predicate", () => {
  it("accepts an owned, in-bounds, empty, ground-supported cell", () => {
    const can = makeInput(buildable());
    expect(can({ plotIndex: 0, col: 3, row: 0 })).toBe(true);
  });

  it("accepts a cell resting on a girder directly below it", () => {
    const can = makeInput(buildable({ girders: [{ col: 3, row: 0 }, { col: 3, row: 1 }] }));
    expect(can({ plotIndex: 0, col: 3, row: 2 })).toBe(true);
  });

  it("pans (rejects) off the plot entirely — the gap between plots / sky", () => {
    const can = makeInput(buildable());
    expect(can(null)).toBe(false);
    expect(can({ plotIndex: 99, col: 0, row: 0 })).toBe(false); // no such plot
  });

  it("pans on a plot you don't own", () => {
    const can = makeInput(buildable({ ownerId: "someone-else" }));
    expect(can({ plotIndex: 0, col: 3, row: 0 })).toBe(false);
  });

  it("pans on a feature (river/park) plot where nothing can be built", () => {
    const can = makeInput(buildable({ feature: "river" }));
    expect(can({ plotIndex: 0, col: 3, row: 0 })).toBe(false);
  });

  it("pans on a cell that already has a girder", () => {
    const can = makeInput(buildable({ girders: [{ col: 3, row: 0 }] }));
    expect(can({ plotIndex: 0, col: 3, row: 0 })).toBe(false);
  });

  it("pans on an unsupported cell floating in the air", () => {
    const can = makeInput(buildable());
    expect(can({ plotIndex: 0, col: 3, row: 5 })).toBe(false);
  });

  it("pans on out-of-bounds columns and rows", () => {
    const can = makeInput(buildable());
    expect(can({ plotIndex: 0, col: -1, row: 0 })).toBe(false);
    expect(can({ plotIndex: 0, col: 8, row: 0 })).toBe(false); // cols are 0..7
    expect(can({ plotIndex: 0, col: 3, row: MAX_ROWS })).toBe(false);
    expect(can({ plotIndex: 0, col: 3, row: -MAX_DEPTH - 1 })).toBe(false);
  });
});
