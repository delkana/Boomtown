import { CELL_SIZE, PLOT_GAP_COLS } from "../game/constants";
import type { GameState } from "../game/types";

/**
 * CityLayout precomputes the horizontal placement of variable-width plots along
 * the strip. Plot widths are fixed at city generation, so this is built once
 * when entering a game and shared by the camera, renderer, and minimap — they
 * all agree on where each plot sits and how wide it is.
 */
export class CityLayout {
  /** World-x of each plot's left edge, indexed by plot index. */
  private lefts: number[] = [];
  /** Width in columns, indexed by plot index. */
  private colsArr: number[] = [];
  /** Total world width of the whole strip (including the trailing gap). */
  totalWorldWidth = 0;

  constructor(state: GameState) {
    const indices = Object.keys(state.plots)
      .map(Number)
      .sort((a, b) => a - b);
    let x = 0;
    for (const i of indices) {
      const cols = state.plots[i].cols;
      this.lefts[i] = x;
      this.colsArr[i] = cols;
      x += (cols + PLOT_GAP_COLS) * CELL_SIZE;
    }
    this.totalWorldWidth = x;
  }

  leftWorldX(index: number): number {
    return this.lefts[index] ?? 0;
  }

  cols(index: number): number {
    return this.colsArr[index] ?? 0;
  }

  /** Plot footprint width in world px. */
  plotWorldWidth(index: number): number {
    return this.cols(index) * CELL_SIZE;
  }

  plotMidWorldX(index: number): number {
    return this.leftWorldX(index) + this.plotWorldWidth(index) / 2;
  }

  /** Map a world-x to a plot + column, or null if it lands in an inter-plot gap. */
  locate(worldX: number): { plotIndex: number; col: number } | null {
    for (let i = 0; i < this.lefts.length; i++) {
      const left = this.lefts[i];
      const cols = this.colsArr[i];
      if (left === undefined || cols === undefined) continue;
      const w = cols * CELL_SIZE;
      if (worldX >= left && worldX < left + w) {
        return { plotIndex: i, col: Math.floor((worldX - left) / CELL_SIZE) };
      }
    }
    return null;
  }
}
