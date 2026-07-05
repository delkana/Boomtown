import { CELL_SIZE, CLAIM_COST, MAX_ROWS, PLOT_COLS, UNIT_DEFS } from "../game/constants";
import type { GameState, Plot } from "../game/types";
import { unitAt } from "../game/reducer";
import { Camera } from "./camera";

/**
 * Renderer: pure READ of GameState -> pixels. It never mutates state and holds
 * no game logic. It draws the whole shared city strip: every player's plots in
 * their owner color, unclaimed plots as "available" land, and the local
 * player's plots with a buildable grid.
 */
export interface HoverState {
  plotIndex: number;
  col: number;
  row: number;
}

/** What the player currently has selected: a build unit, "claim", or nothing. */
export type Tool = keyof typeof UNIT_DEFS | "claim" | null;

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
    localPlayerId: string,
    hover: HoverState | null,
    tool: Tool,
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

    for (const key of Object.keys(state.plots)) {
      this.drawPlot(state, state.plots[Number(key)], localPlayerId);
    }

    if (hover) this.drawHoverGhost(state, localPlayerId, hover, tool);
  }

  private drawPlot(state: GameState, plot: Plot, localId: string): void {
    const { ctx, camera } = this;
    const leftWorld = camera.plotLeftWorldX(plot.index);
    const leftScreen = camera.worldToScreenX(leftWorld);
    const plotPxW = PLOT_COLS * CELL_SIZE;

    // Cull off-screen plots.
    if (leftScreen + plotPxW < 0 || leftScreen > camera.viewW) return;

    const groundY = camera.viewH - camera.groundMargin;
    const owner = plot.ownerId ? state.players[plot.ownerId] : undefined;
    const isOwn = plot.ownerId === localId;
    const ownerColor = owner?.color ?? "#9fb0c0";

    // Plot pad.
    if (!plot.ownerId) {
      // Unclaimed / for sale.
      ctx.fillStyle = "rgba(120,200,120,0.05)";
      ctx.fillRect(leftScreen, camera.rowTopScreenY(MAX_ROWS - 1), plotPxW, MAX_ROWS * CELL_SIZE);
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = "rgba(150,210,150,0.35)";
      ctx.lineWidth = 1;
      ctx.strokeRect(leftScreen + 2, groundY - CELL_SIZE * 3, plotPxW - 4, CELL_SIZE * 3);
      ctx.restore();
    } else {
      ctx.fillStyle = isOwn ? withAlpha(ownerColor, 0.16) : withAlpha(ownerColor, 0.07);
      ctx.fillRect(leftScreen, camera.rowTopScreenY(MAX_ROWS - 1), plotPxW, MAX_ROWS * CELL_SIZE);
    }

    // Buildable grid lines (own plots only).
    if (isOwn) {
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
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

      // Owner-color band along the top edge so ownership reads at a glance.
      ctx.fillStyle = ownerColor;
      ctx.fillRect(x + 1, y + 1, wpx - 2, 3);

      // Occupancy shading for revenue units.
      if (def.incomeAtFull > 0) {
        ctx.fillStyle = "rgba(255,220,120,0.4)";
        const litW = (wpx - 6) * unit.occupancy;
        ctx.fillRect(x + 3, y + CELL_SIZE - 8, litW, 4);
      }

      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.font = "10px system-ui, sans-serif";
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillText(def.label, x + 4, y + 6);
    }

    // Nameplate under the plot.
    ctx.font = "12px system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    const cx = leftScreen + plotPxW / 2;
    if (!plot.ownerId) {
      ctx.fillStyle = "rgba(150,210,150,0.8)";
      ctx.fillText("Available", cx, groundY + 10);
      ctx.fillStyle = "rgba(150,210,150,0.55)";
      ctx.fillText(`$${CLAIM_COST.toLocaleString()}`, cx, groundY + 26);
    } else {
      ctx.fillStyle = ownerColor;
      ctx.fillText(isOwn ? `★ You (${owner?.name ?? ""})` : owner?.name ?? "", cx, groundY + 10);
    }
    ctx.textAlign = "left";
  }

  private drawHoverGhost(
    state: GameState,
    localId: string,
    hover: HoverState,
    tool: Tool,
  ): void {
    const { ctx, camera } = this;
    const plot = state.plots[hover.plotIndex];
    if (!plot || !tool) return;
    const leftWorld = camera.plotLeftWorldX(hover.plotIndex);

    if (tool === "claim") {
      if (plot.ownerId) return; // only unclaimed plots are claimable
      const canAfford = (state.players[localId]?.money ?? 0) >= CLAIM_COST;
      const x = camera.worldToScreenX(leftWorld);
      const top = camera.rowTopScreenY(2);
      const hgt = camera.viewH - camera.groundMargin - top;
      ctx.fillStyle = canAfford ? "rgba(120,220,120,0.18)" : "rgba(200,70,70,0.18)";
      ctx.fillRect(x, top, PLOT_COLS * CELL_SIZE, hgt);
      ctx.strokeStyle = canAfford ? "#78dc78" : "#c84646";
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, top + 1, PLOT_COLS * CELL_SIZE - 2, hgt - 2);
      return;
    }

    // Build tool: only meaningful on plots the local player owns.
    if (plot.ownerId !== localId) return;
    const def = UNIT_DEFS[tool];
    const x = camera.worldToScreenX(leftWorld + hover.col * CELL_SIZE);
    const y = camera.rowTopScreenY(hover.row);
    const wpx = def.width * CELL_SIZE;

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

/** Apply an alpha to a #rrggbb hex, returning an rgba() string. */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(159,176,192,${alpha})`;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}
