import { CELL_SIZE, PLOT_COLS, PLOT_GAP_COLS } from "../game/constants";

/**
 * Camera + coordinate transforms for the horizontal city strip.
 *
 * WORLD space: x grows rightward across plots, y grows UPWARD (row 0 = ground).
 * SCREEN space: standard canvas pixels, y grows downward.
 *
 * The camera only pans horizontally (`offsetX`); the ground line is pinned near
 * the bottom of the viewport. This is shared by both the renderer and input so
 * mouse->cell math and drawing agree exactly.
 */
export class Camera {
  /** Horizontal world offset in pixels (what's scrolled off to the left). */
  offsetX = 0;
  viewW = 0;
  viewH = 0;

  /** Pixels from the bottom of the canvas to the ground line (row 0's base). */
  readonly groundMargin = 80;

  resize(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
  }

  /** World-x of a plot's left edge, in pixels. */
  plotLeftWorldX(plotIndex: number): number {
    const stride = (PLOT_COLS + PLOT_GAP_COLS) * CELL_SIZE;
    return plotIndex * stride;
  }

  /** Screen y of the TOP edge of a given row (floor). */
  rowTopScreenY(row: number): number {
    const groundScreenY = this.viewH - this.groundMargin;
    return groundScreenY - (row + 1) * CELL_SIZE;
  }

  /** Screen x of a world-x. */
  worldToScreenX(worldX: number): number {
    return worldX - this.offsetX;
  }

  /** World-x from a screen x. */
  screenToWorldX(screenX: number): number {
    return screenX + this.offsetX;
  }

  /**
   * Convert a screen point to a (plotIndex, col, row) cell, or null if the
   * point isn't inside any plot's buildable footprint.
   */
  screenToCell(
    screenX: number,
    screenY: number,
  ): { plotIndex: number; col: number; row: number } | null {
    const worldX = this.screenToWorldX(screenX);
    const stride = (PLOT_COLS + PLOT_GAP_COLS) * CELL_SIZE;
    const plotIndex = Math.floor(worldX / stride);
    const withinPlotX = worldX - plotIndex * stride;
    const col = Math.floor(withinPlotX / CELL_SIZE);
    if (col < 0 || col >= PLOT_COLS) return null; // in the gap between plots

    const groundScreenY = this.viewH - this.groundMargin;
    const row = Math.floor((groundScreenY - screenY) / CELL_SIZE);
    if (row < 0) return null; // below ground

    return { plotIndex, col, row };
  }

  clampToWorld(minPlotIndex: number, maxPlotIndex: number): void {
    const stride = (PLOT_COLS + PLOT_GAP_COLS) * CELL_SIZE;
    const min = minPlotIndex * stride - CELL_SIZE * 2;
    const max = (maxPlotIndex + 1) * stride - this.viewW + CELL_SIZE * 2;
    if (this.offsetX < min) this.offsetX = min;
    if (max > min && this.offsetX > max) this.offsetX = max;
  }
}
