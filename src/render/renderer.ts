import { CELL_SIZE, MAX_ROWS, UNIT_DEFS } from "../game/constants";
import type { GameState, Plot } from "../game/types";
import { unitAt, hasGirder } from "../game/reducer";
import { claimCost } from "../game/economy";
import { featureLabel } from "../game/features";
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

/** What the player currently has selected: a build unit, girder, claim, or nothing. */
export type Tool = keyof typeof UNIT_DEFS | "claim" | "girder" | null;

/** Steel-frame color for structural girders. */
const GIRDER_COLOR = "#b5793a";

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
    const cell = camera.scale(CELL_SIZE); // screen px per grid cell at current zoom
    const leftWorld = camera.plotLeftWorldX(plot.index);
    const leftScreen = camera.worldToScreenX(leftWorld);
    const plotPxW = plot.cols * cell;

    // Cull off-screen plots.
    if (leftScreen + plotPxW < 0 || leftScreen > camera.viewW) return;

    // Feature plots (river/park/highway) draw their own art and no build grid.
    if (plot.feature) {
      this.drawFeature(plot, leftScreen, plotPxW, cell);
      return;
    }

    const groundY = camera.groundScreenY;
    const owner = plot.ownerId ? state.players[plot.ownerId] : undefined;
    const isOwn = plot.ownerId === localId;
    const ownerColor = owner?.color ?? "#9fb0c0";

    // Plot pad.
    if (!plot.ownerId) {
      // Unclaimed / for sale.
      ctx.fillStyle = "rgba(120,200,120,0.05)";
      ctx.fillRect(leftScreen, camera.rowTopScreenY(MAX_ROWS - 1), plotPxW, MAX_ROWS * cell);
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = "rgba(150,210,150,0.35)";
      ctx.lineWidth = 1;
      ctx.strokeRect(leftScreen + 2, groundY - cell * 3, plotPxW - 4, cell * 3);
      ctx.restore();
    } else {
      ctx.fillStyle = isOwn ? withAlpha(ownerColor, 0.16) : withAlpha(ownerColor, 0.07);
      ctx.fillRect(leftScreen, camera.rowTopScreenY(MAX_ROWS - 1), plotPxW, MAX_ROWS * cell);
    }

    // Buildable grid lines (own plots only).
    if (isOwn) {
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 1;
      for (let c = 0; c <= plot.cols; c++) {
        const x = leftScreen + c * cell;
        ctx.beginPath();
        ctx.moveTo(x, camera.rowTopScreenY(MAX_ROWS - 1));
        ctx.lineTo(x, groundY);
        ctx.stroke();
      }
      for (let r = 0; r <= MAX_ROWS; r++) {
        const y = camera.rowTopScreenY(r) + cell;
        ctx.beginPath();
        ctx.moveTo(leftScreen, y);
        ctx.lineTo(leftScreen + plotPxW, y);
        ctx.stroke();
      }
    }

    // Structural girders (drawn first; rooms are painted over them).
    for (const g of plot.girders ?? []) {
      const gx = camera.worldToScreenX(leftWorld + g.col * CELL_SIZE);
      const gy = camera.rowTopScreenY(g.row);
      this.drawGirder(gx, gy, cell);
    }

    // Units.
    const bandH = Math.max(2, cell * 0.07);
    const showLabels = cell >= 30;
    for (const unit of plot.units) {
      const def = UNIT_DEFS[unit.kind];
      const x = camera.worldToScreenX(leftWorld + unit.col * CELL_SIZE);
      const y = camera.rowTopScreenY(unit.row);
      const wpx = unit.width * cell;

      ctx.fillStyle = def.color;
      ctx.fillRect(x + 1, y + 1, wpx - 2, cell - 2);

      // Owner-color band along the top edge so ownership reads at a glance.
      ctx.fillStyle = ownerColor;
      ctx.fillRect(x + 1, y + 1, wpx - 2, bandH);

      // Occupancy shading for revenue units.
      if (def.incomeAtFull > 0) {
        ctx.fillStyle = "rgba(255,220,120,0.4)";
        const barH = Math.max(3, cell * 0.16);
        const litW = (wpx - 6) * unit.occupancy;
        ctx.fillRect(x + 3, y + cell - barH - 2, litW, barH);
      }

      if (showLabels) {
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.font = `${Math.min(11, cell * 0.24)}px system-ui, sans-serif`;
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        ctx.fillText(def.label, x + 4, y + bandH + 3);
      }
    }

    // Nameplate under the plot: themed property name, then owner / status.
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    const cx = leftScreen + plotPxW / 2;

    ctx.font = "600 12px system-ui, sans-serif";
    ctx.fillStyle = "rgba(231,238,245,0.9)";
    ctx.fillText(plot.name, cx, groundY + 9);

    ctx.font = "11px system-ui, sans-serif";
    if (!plot.ownerId) {
      const price = claimCost(state, localId, plot.index);
      ctx.fillStyle = "rgba(150,210,150,0.85)";
      ctx.fillText(
        `${plot.cols}-wide · Available · $${price.toLocaleString()}`,
        cx,
        groundY + 25,
      );
    } else {
      ctx.fillStyle = ownerColor;
      ctx.fillText(isOwn ? `★ You · ${owner?.name ?? ""}` : owner?.name ?? "", cx, groundY + 25);
    }
    ctx.textAlign = "left";
  }

  /** Draw a single structural girder (steel frame + cross-brace) in a cell. */
  private drawGirder(x: number, y: number, cell: number): void {
    const { ctx } = this;
    const t = Math.max(1, cell * 0.09); // beam thickness
    ctx.fillStyle = GIRDER_COLOR;
    // Outer frame.
    ctx.fillRect(x, y, cell, t); // top
    ctx.fillRect(x, y + cell - t, cell, t); // bottom
    ctx.fillRect(x, y, t, cell); // left
    ctx.fillRect(x + cell - t, y, t, cell); // right
    // Diagonal cross-brace.
    ctx.strokeStyle = GIRDER_COLOR;
    ctx.lineWidth = Math.max(1, cell * 0.06);
    ctx.beginPath();
    ctx.moveTo(x + t, y + t);
    ctx.lineTo(x + cell - t, y + cell - t);
    ctx.moveTo(x + cell - t, y + t);
    ctx.lineTo(x + t, y + cell - t);
    ctx.stroke();
  }

  /** Draw a non-buildable city feature (river / park / highway) + its nameplate. */
  private drawFeature(plot: Plot, leftScreen: number, plotPxW: number, cell: number): void {
    const { ctx, camera } = this;
    const groundY = camera.groundScreenY;
    const kind = plot.feature!;

    if (kind === "park") {
      // Grass mound + trees.
      ctx.fillStyle = "#2f6b3a";
      ctx.fillRect(leftScreen, groundY - cell * 0.7, plotPxW, cell * 0.7 + 4);
      ctx.fillStyle = "#8a6a3a"; // path
      ctx.fillRect(leftScreen + plotPxW * 0.45, groundY - cell * 0.7, plotPxW * 0.1, cell * 0.7);
      for (const f of [0.18, 0.36, 0.62, 0.82]) {
        const tx = leftScreen + plotPxW * f;
        const ty = groundY - cell * 0.9;
        ctx.fillStyle = "#5a3f28";
        ctx.fillRect(tx - cell * 0.03, ty, cell * 0.06, cell * 0.5);
        ctx.fillStyle = "#3f9a52";
        ctx.beginPath();
        ctx.arc(tx, ty, cell * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (kind === "river") {
      // The bridge sits flush with the surrounding ground; the water runs in a
      // lowered channel beneath it.
      const gm = camera.groundMargin;
      // Carve the channel out of the ground band (under-bridge shadow).
      ctx.fillStyle = "#16232f";
      ctx.fillRect(leftScreen, groundY, plotPxW, gm);
      // Lowered water at the bottom of the channel.
      const waterY = groundY + gm * 0.58;
      const water = ctx.createLinearGradient(0, waterY, 0, groundY + gm);
      water.addColorStop(0, "#3a7bb0");
      water.addColorStop(1, "#1e4a70");
      ctx.fillStyle = water;
      ctx.fillRect(leftScreen, waterY, plotPxW, groundY + gm - waterY);
      // Bridge deck — its surface is level with the ground line.
      const deckH = Math.max(6, cell * 0.28);
      ctx.fillStyle = "#565b63"; // pylons, drawn first so the deck caps them
      for (const f of [0.3, 0.7]) {
        ctx.fillRect(leftScreen + plotPxW * f - cell * 0.06, groundY + deckH, cell * 0.12, waterY - (groundY + deckH));
      }
      ctx.fillStyle = "#6b7079";
      ctx.fillRect(leftScreen - cell * 0.1, groundY, plotPxW + cell * 0.2, deckH);
      ctx.fillStyle = "#8a9099"; // railing just above the deck
      ctx.fillRect(leftScreen - cell * 0.1, groundY - 3, plotPxW + cell * 0.2, 3);
    } else {
      // Elevated highway: deck a few floors up on wide pillars, with concrete
      // edge walls and a couple of cars.
      const deckY = camera.rowTopScreenY(3);
      const deckH = cell * 0.5;
      const pillarW = cell * 0.34; // >= 2x the old width
      ctx.fillStyle = "#4a4e56"; // pillars, pushed toward the plot edges
      for (const f of [0.12, 0.5, 0.88]) {
        ctx.fillRect(leftScreen + plotPxW * f - pillarW / 2, deckY + deckH, pillarW, groundY - (deckY + deckH));
      }
      // Deck slab.
      ctx.fillStyle = "#6b7079";
      ctx.fillRect(leftScreen - cell * 0.1, deckY, plotPxW + cell * 0.2, deckH);
      // Road surface, inset between the edge walls.
      const wall = Math.max(2, deckH * 0.16);
      const roadY = deckY + wall;
      const roadH = deckH - wall * 2;
      ctx.fillStyle = "#2a2d33";
      ctx.fillRect(leftScreen - cell * 0.1, roadY, plotPxW + cell * 0.2, roadH);
      // Concrete edge walls (top + bottom) so cars can't drive off.
      ctx.fillStyle = "#9aa0a8";
      ctx.fillRect(leftScreen - cell * 0.1, deckY, plotPxW + cell * 0.2, wall);
      ctx.fillRect(leftScreen - cell * 0.1, deckY + deckH - wall, plotPxW + cell * 0.2, wall);
      // Cars on the road.
      for (const [f, col] of [[0.34, "#e0d24a"], [0.62, "#e0503f"]] as const) {
        ctx.fillStyle = col;
        ctx.fillRect(leftScreen + plotPxW * f, roadY + roadH * 0.2, cell * 0.5, roadH * 0.6);
      }
    }

    // Nameplate: feature name + type label.
    const cx = leftScreen + plotPxW / 2;
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.fillStyle = "rgba(200,214,226,0.9)";
    ctx.fillText(plot.name, cx, groundY + 9);
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillStyle = "rgba(150,170,190,0.7)";
    ctx.fillText(featureLabel(kind), cx, groundY + 25);
    ctx.textAlign = "left";
  }

  private drawHoverGhost(
    state: GameState,
    localId: string,
    hover: HoverState,
    tool: Tool,
  ): void {
    const { ctx, camera } = this;
    const cell = camera.scale(CELL_SIZE);
    const plot = state.plots[hover.plotIndex];
    if (!plot || !tool) return;
    const leftWorld = camera.plotLeftWorldX(hover.plotIndex);

    if (tool === "claim") {
      if (plot.ownerId || plot.feature) return; // features & owned plots aren't claimable
      const canAfford =
        (state.players[localId]?.money ?? 0) >= claimCost(state, localId, plot.index);
      const x = camera.worldToScreenX(leftWorld);
      const top = camera.rowTopScreenY(2);
      const hgt = camera.groundScreenY - top;
      const w = plot.cols * cell;
      ctx.fillStyle = canAfford ? "rgba(120,220,120,0.18)" : "rgba(200,70,70,0.18)";
      ctx.fillRect(x, top, w, hgt);
      ctx.strokeStyle = canAfford ? "#78dc78" : "#c84646";
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, top + 1, w - 2, hgt - 2);
      return;
    }

    // Girder tool: a single structural cell.
    if (tool === "girder") {
      if (plot.ownerId !== localId) return;
      const gx = camera.worldToScreenX(leftWorld + hover.col * CELL_SIZE);
      const gy = camera.rowTopScreenY(hover.row);
      const supported = hover.row === 0 || hasGirder(plot, hover.col, hover.row - 1);
      const blocked =
        hover.col >= plot.cols ||
        hover.row >= MAX_ROWS ||
        hasGirder(plot, hover.col, hover.row) ||
        !supported;
      ctx.fillStyle = blocked ? "rgba(200,70,70,0.30)" : "rgba(181,121,58,0.45)";
      ctx.fillRect(gx + 1, gy + 1, cell - 2, cell - 2);
      ctx.strokeStyle = blocked ? "#c84646" : GIRDER_COLOR;
      ctx.lineWidth = 2;
      ctx.strokeRect(gx + 1, gy + 1, cell - 2, cell - 2);
      return;
    }

    // Build tool: only meaningful on plots the local player owns.
    if (plot.ownerId !== localId) return;
    const def = UNIT_DEFS[tool];
    const x = camera.worldToScreenX(leftWorld + hover.col * CELL_SIZE);
    const y = camera.rowTopScreenY(hover.row);
    const wpx = def.width * cell;

    const blocked =
      hover.col + def.width > plot.cols ||
      hover.row >= MAX_ROWS ||
      !!unitAt(plot, hover.col, hover.row);
    ctx.fillStyle = blocked ? "rgba(200,70,70,0.35)" : "rgba(120,220,120,0.35)";
    ctx.fillRect(x + 1, y + 1, wpx - 2, cell - 2);
    ctx.strokeStyle = blocked ? "#c84646" : "#78dc78";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, wpx - 2, cell - 2);
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
