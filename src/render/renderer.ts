import { CELL_SIZE, MAX_ROWS, PLOT_COLS, UNIT_DEFS } from "../game/constants";
import type { GameState, Plot } from "../game/types";
import { unitAt } from "../game/reducer";
import { Camera } from "./camera";

/**
 * Renderer: pure READ of GameState -> pixels. It never mutates state and holds
 * no game logic; swapping it out (or adding a second viewport) changes nothing
 * about the simulation. This is the "V" that stays on the client forever.
 */
export interface HoverState {
  plotIndex: number;
  col: number;
  row: number;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;

  constructor(
    canvas: HTMLCanvasElement,
    private camera: Camera,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
  }

  render(
    state: GameState,
    hover: HoverState | null,
    selectedKind: string | null,
  ): void {
    const { ctx, camera } = this;
    const w = camera.viewW;
    const h = camera.viewH;

    // Sky gradient.
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#1b2838");
    sky.addColorStop(1, "#3a5068");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Ground.
    const groundY = h - camera.groundMargin;
    ctx.fillStyle = "#2a2018";
    ctx.fillRect(0, groundY, w, camera.groundMargin);
    ctx.fillStyle = "#3d2f22";
    ctx.fillRect(0, groundY, w, 4);

    // Draw each plot.
    const localId = state.localPlayerId;
    for (const key of Object.keys(state.plots)) {
      this.drawPlot(state.plots[Number(key)], localId);
    }

    // Hover ghost for the currently selected build tool.
    if (hover && selectedKind) {
      this.drawHoverGhost(state, hover, selectedKind);
    }
  }

  private drawPlot(plot: Plot, localId: string): void {
    const { ctx, camera } = this;
    const leftWorld = camera.plotLeftWorldX(plot.index);
    const leftScreen = camera.worldToScreenX(leftWorld);
    const plotPxW = PLOT_COLS * CELL_SIZE;

    // Cull off-screen plots.
    if (leftScreen + plotPxW < 0 || leftScreen > camera.viewW) return;

    const groundY = camera.viewH - camera.groundMargin;
    const isOwn = plot.ownerId === localId;

    // Plot pad + label.
    ctx.fillStyle = isOwn ? "rgba(90,143,176,0.10)" : "rgba(255,255,255,0.03)";
    ctx.fillRect(leftScreen, camera.rowTopScreenY(MAX_ROWS - 1), plotPxW, MAX_ROWS * CELL_SIZE);

    // Buildable grid lines (own plot only).
    if (isOwn) {
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      for (let c = 0; c <= PLOT_COLS; c++) {
        const x = leftScreen + c * CELL_SIZE;
        ctx.beginPath();
        ctx.moveTo(x, camera.rowTopScreenY(MAX_ROWS - 1));
        ctx.lineTo(x, groundY);
        ctx.stroke();
      }
      for (let r = 0; r <= MAX_ROWS; r++) {
        const y = camera.rowTopScreenY(r) + CELL_SIZE;
        ctx.beginPath();
        ctx.moveTo(leftScreen, y);
        ctx.lineTo(leftScreen + plotPxW, y);
        ctx.stroke();
      }
    }

    // Units.
    for (const unit of plot.units) {
      const def = UNIT_DEFS[unit.kind];
      const x = camera.worldToScreenX(leftWorld + unit.col * CELL_SIZE);
      const y = camera.rowTopScreenY(unit.row);
      const wpx = unit.width * CELL_SIZE;

      ctx.fillStyle = def.color;
      ctx.fillRect(x + 1, y + 1, wpx - 2, CELL_SIZE - 2);

      // Occupancy shading for revenue units.
      if (def.incomeAtFull > 0) {
        ctx.fillStyle = "rgba(255,220,120,0.35)";
        const litW = (wpx - 6) * unit.occupancy;
        ctx.fillRect(x + 3, y + CELL_SIZE - 8, litW, 4);
      }

      // Simple iconography.
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.font = "10px system-ui, sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText(def.label, x + 4, y + 4);
    }

    // Neighbor stub silhouette so the "city" reads as populated.
    if (!isOwn) {
      this.drawStubBuilding(plot, leftScreen, plotPxW, groundY);
    }

    // Owner nameplate under the plot.
    ctx.fillStyle = isOwn ? "#cfe3f0" : "rgba(255,255,255,0.45)";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    ctx.fillText(
      isOwn ? "★ Your Plot" : plot.ownerName,
      leftScreen + plotPxW / 2,
      groundY + 10,
    );
    ctx.textAlign = "left";
  }

  /** Deterministic pseudo-building for a stub neighbor plot (no state stored). */
  private drawStubBuilding(
    plot: Plot,
    leftScreen: number,
    plotPxW: number,
    groundY: number,
  ): void {
    const { ctx } = this;
    // Height derived from the plot index so it's stable frame to frame.
    const seed = Math.abs(plot.index * 2654435761) % 2 ** 31;
    const floors = 3 + (seed % 9);
    const bw = plotPxW * 0.7;
    const bx = leftScreen + (plotPxW - bw) / 2;
    const top = groundY - floors * CELL_SIZE;

    ctx.fillStyle = "rgba(20,28,40,0.85)";
    ctx.fillRect(bx, top, bw, floors * CELL_SIZE);

    // Lit windows.
    ctx.fillStyle = "rgba(255,225,150,0.25)";
    for (let f = 0; f < floors; f++) {
      for (let wcol = 0; wcol < 3; wcol++) {
        if ((seed >> (f + wcol)) & 1) {
          ctx.fillRect(bx + 8 + wcol * (bw / 3), top + f * CELL_SIZE + 8, 12, 16);
        }
      }
    }
  }

  private drawHoverGhost(
    state: GameState,
    hover: HoverState,
    kind: string,
  ): void {
    const { ctx, camera } = this;
    if (hover.plotIndex !== 0) return; // only own plot buildable in MVP
    const def = UNIT_DEFS[kind as keyof typeof UNIT_DEFS];
    if (!def) return;
    const plot = state.plots[hover.plotIndex];
    if (!plot) return;

    const leftWorld = camera.plotLeftWorldX(hover.plotIndex);
    const x = camera.worldToScreenX(leftWorld + hover.col * CELL_SIZE);
    const y = camera.rowTopScreenY(hover.row);
    const wpx = def.width * CELL_SIZE;

    // Green when the cell looks placeable, red otherwise (cheap client-side
    // hint; the reducer remains the authority).
    const blocked =
      hover.col + def.width > PLOT_COLS ||
      hover.row >= MAX_ROWS ||
      !!unitAt(plot, hover.col, hover.row);
    ctx.fillStyle = blocked ? "rgba(200,70,70,0.35)" : "rgba(120,220,120,0.35)";
    ctx.fillRect(x + 1, y + 1, wpx - 2, CELL_SIZE - 2);
    ctx.strokeStyle = blocked ? "#c84646" : "#78dc78";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, wpx - 2, CELL_SIZE - 2);
  }
}
