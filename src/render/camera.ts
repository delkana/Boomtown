import { CELL_SIZE, PLOT_COLS, PLOT_GAP_COLS } from "../game/constants";

/**
 * Camera + coordinate transforms for the horizontal city strip.
 *
 * WORLD space: x grows rightward across plots, y grows UPWARD (row 0 = ground).
 * SCREEN space: standard canvas pixels, y grows downward.
 *
 * The camera pans horizontally (`offsetX`, in world units) and zooms uniformly
 * (`zoom`). The ground line is pinned near the bottom of the viewport. Renderer
 * and input share these transforms so mouse->cell math and drawing agree.
 */
export class Camera {
  /** World-x shown at screen x=0 (in world units, i.e. pre-zoom pixels). */
  offsetX = 0;
  /** Uniform zoom factor: screen px per world px. */
  zoom = 1;
  viewW = 0;
  viewH = 0;

  /** Pixels from the bottom of the canvas to the ground line (row 0's base). */
  readonly groundMargin = 80;
  readonly minZoom = 0.4;
  readonly maxZoom = 1.8;

  resize(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
  }

  /** World-x span of one plot + its trailing gap. */
  get stride(): number {
    return (PLOT_COLS + PLOT_GAP_COLS) * CELL_SIZE;
  }

  /** Screen y of the ground line (base of row 0). */
  get groundScreenY(): number {
    return this.viewH - this.groundMargin;
  }

  /** World-x of a plot's left edge. */
  plotLeftWorldX(plotIndex: number): number {
    return plotIndex * this.stride;
  }

  /** Convert a world length to screen pixels at the current zoom. */
  scale(worldLen: number): number {
    return worldLen * this.zoom;
  }

  /** Screen y of the TOP edge of a given row (floor). */
  rowTopScreenY(row: number): number {
    return this.groundScreenY - (row + 1) * CELL_SIZE * this.zoom;
  }

  /** Screen x of a world-x. */
  worldToScreenX(worldX: number): number {
    return (worldX - this.offsetX) * this.zoom;
  }

  /** World-x from a screen x. */
  screenToWorldX(screenX: number): number {
    return this.offsetX + screenX / this.zoom;
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
    const plotIndex = Math.floor(worldX / this.stride);
    const withinPlotX = worldX - plotIndex * this.stride;
    const col = Math.floor(withinPlotX / CELL_SIZE);
    if (col < 0 || col >= PLOT_COLS) return null; // in the gap between plots

    const row = Math.floor((this.groundScreenY - screenY) / (CELL_SIZE * this.zoom));
    if (row < 0) return null; // below ground

    return { plotIndex, col, row };
  }

  /** Set zoom while keeping the world point under `screenX` fixed on screen. */
  setZoomAt(newZoom: number, screenX: number): void {
    const z = Math.max(this.minZoom, Math.min(this.maxZoom, newZoom));
    const worldX = this.screenToWorldX(screenX);
    this.zoom = z;
    this.offsetX = worldX - screenX / z;
  }

  /** Center the viewport on a world-x. */
  centerOnWorldX(worldX: number): void {
    this.offsetX = worldX - this.viewW / this.zoom / 2;
  }

  /** Center on a plot's midpoint. */
  centerOnPlot(plotIndex: number): void {
    this.centerOnWorldX(this.plotLeftWorldX(plotIndex) + (PLOT_COLS * CELL_SIZE) / 2);
  }

  clampToWorld(minPlotIndex: number, maxPlotIndex: number): void {
    const margin = CELL_SIZE * 2;
    const contentLeft = minPlotIndex * this.stride - margin;
    const contentRight = (maxPlotIndex + 1) * this.stride - PLOT_GAP_COLS * CELL_SIZE + margin;
    const viewWorld = this.viewW / this.zoom;
    const min = contentLeft;
    const max = contentRight - viewWorld;
    if (max < min) {
      // Content narrower than the viewport — center it.
      this.offsetX = (min + max) / 2;
      return;
    }
    if (this.offsetX < min) this.offsetX = min;
    if (this.offsetX > max) this.offsetX = max;
  }
}
