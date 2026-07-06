import { CELL_SIZE, MAX_ROWS, UNIT_DEFS } from "../game/constants";
import type { GameState, Plot } from "../game/types";
import { unitAt, hasGirder, girderSupported } from "../game/reducer";
import { claimCost, girderCost } from "../game/economy";
import { featureLabel } from "../game/features";
import { heatT, type HeatmapKind } from "../game/heatmaps";
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

/** What the player currently has selected: a build unit, girder, claim, destroy, or nothing. */
export type Tool = keyof typeof UNIT_DEFS | "claim" | "girder" | "destroy" | null;

/** A brief floating "-$X" / "+$X" label at the cursor after a money change. */
interface Popup {
  x: number;
  y: number;
  text: string;
  color: string;
  born: number;
}
const POPUP_LIFE_MS = 950;

/** Steel-frame color for structural girders. */
const GIRDER_COLOR = "#5c6470";
/** Lighter edge highlight so the steel beams read against the dark plot. */
const GIRDER_HILITE = "#7a828f";

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private popups: Popup[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    private camera: Camera,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
  }

  /**
   * Spawn a floating money label at a screen point: red for a spend (negative
   * delta), green for money returned (positive).
   */
  addMoneyPopup(screenX: number, screenY: number, delta: number): void {
    if (delta === 0) return;
    this.popups.push({
      x: screenX,
      y: screenY,
      text: `${delta < 0 ? "-" : "+"}$${Math.abs(delta).toLocaleString()}`,
      color: delta < 0 ? "#e8776f" : "#7bd88f",
      born: performance.now(),
    });
  }

  private drawPopups(): void {
    if (this.popups.length === 0) return;
    const now = performance.now();
    this.popups = this.popups.filter((p) => now - p.born < POPUP_LIFE_MS);
    const { ctx } = this;
    ctx.save();
    ctx.font = "bold 14px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    for (const p of this.popups) {
      const t = (now - p.born) / POPUP_LIFE_MS;
      const y = p.y - 8 - t * 28; // drift upward
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillText(p.text, p.x + 1, y + 1);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, y);
    }
    ctx.restore();
  }

  render(
    state: GameState,
    localPlayerId: string,
    hover: HoverState | null,
    tool: Tool,
    heatmap: HeatmapKind,
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

    // The plot airspace grid + dashed outlines only show while a tool is active.
    const showGrid = tool !== null;
    for (const key of Object.keys(state.plots)) {
      this.drawPlot(state, state.plots[Number(key)], localPlayerId, showGrid);
    }

    // Heatmap overlay on the local player's own plots.
    if (heatmap !== "none") {
      for (const key of Object.keys(state.plots)) {
        const plot = state.plots[Number(key)];
        if (plot.ownerId === localPlayerId) this.drawHeatmap(plot, heatmap);
      }
    }

    if (hover) this.drawHoverGhost(state, localPlayerId, hover, tool);

    this.drawPopups();
  }

  /** Tint each cell of an owned plot by a normalized heatmap rating. */
  private drawHeatmap(plot: Plot, kind: HeatmapKind): void {
    const { ctx, camera } = this;
    const cell = camera.scale(CELL_SIZE);
    const leftScreen = camera.worldToScreenX(camera.plotLeftWorldX(plot.index));
    if (leftScreen + plot.cols * cell < 0 || leftScreen > camera.viewW) return;

    let maxRow = 0;
    for (const u of plot.units) maxRow = Math.max(maxRow, u.row);
    for (const g of plot.girders ?? []) maxRow = Math.max(maxRow, g.row);
    const top = Math.min(MAX_ROWS - 1, Math.max(7, maxRow + 3));

    for (let row = 0; row <= top; row++) {
      const y = camera.rowTopScreenY(row);
      for (let col = 0; col < plot.cols; col++) {
        ctx.fillStyle = heatColor(heatT(kind, plot, col, row));
        ctx.fillRect(leftScreen + col * cell + 1, y + 1, cell - 2, cell - 2);
      }
    }
  }

  private drawPlot(state: GameState, plot: Plot, localId: string, showGrid: boolean): void {
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

    // Plot airspace pad + grid + dashed outlines — only while a tool is active.
    if (showGrid) {
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
    }

    // Structural girders (drawn first; rooms are painted over them).
    for (const g of plot.girders ?? []) {
      const gx = camera.worldToScreenX(leftWorld + g.col * CELL_SIZE);
      const gy = camera.rowTopScreenY(g.row);
      this.drawGirder(gx, gy, cell);
    }

    // Units (elevators are drawn separately, as continuous shafts).
    const bandH = Math.max(2, cell * 0.07);
    const showLabels = cell >= 30;
    for (const unit of plot.units) {
      if (unit.kind === "elevator") continue;
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

    // Elevators: contiguous vertical runs render as one continuous shaft.
    for (const run of elevatorRuns(plot)) {
      const x = camera.worldToScreenX(leftWorld + run.col * CELL_SIZE);
      const yTop = camera.rowTopScreenY(run.to);
      const yBottom = camera.rowTopScreenY(run.from) + cell;
      this.drawElevatorShaft(x, yTop, cell, yBottom - yTop, run.to > run.from, ownerColor, bandH);
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

  /**
   * Draw an elevator run. A single tile looks like a plain elevator; two or more
   * stacked tiles render as one continuous shaft (rails + a car), not separate
   * boxes.
   */
  private drawElevatorShaft(
    x: number,
    yTop: number,
    cell: number,
    height: number,
    continuous: boolean,
    ownerColor: string,
    bandH: number,
  ): void {
    const { ctx } = this;
    const w = cell;
    if (!continuous) {
      // Single elevator — the classic tile look.
      ctx.fillStyle = UNIT_DEFS.elevator.color;
      ctx.fillRect(x + 1, yTop + 1, w - 2, cell - 2);
    } else {
      // Continuous shaft: dark channel, two guide rails, and one car.
      ctx.fillStyle = "#3a3f47";
      ctx.fillRect(x + 1, yTop + 1, w - 2, height - 2);
      ctx.fillStyle = "#8a8f98";
      ctx.fillRect(x + 3, yTop + 2, 2, height - 4);
      ctx.fillRect(x + w - 5, yTop + 2, 2, height - 4);
      // Car parked at the bottom of the shaft.
      const carH = Math.min(cell * 0.85, height - 6);
      ctx.fillStyle = "#aab0b8";
      ctx.fillRect(x + 6, yTop + height - carH - 3, w - 12, carH);
    }
    // Owner-color band along the very top of the run.
    ctx.fillStyle = ownerColor;
    ctx.fillRect(x + 1, yTop + 1, w - 2, bandH);
  }

  /** Small price tag centered at (cx, baselineY) — used for the live girder cost. */
  private drawPriceTag(text: string, cx: number, baselineY: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = "rgba(16,22,32,0.85)";
    ctx.fillRect(cx - w / 2, baselineY - 14, w, 14);
    ctx.fillStyle = "#dfe7ef";
    ctx.fillText(text, cx, baselineY - 2);
    ctx.restore();
  }

  /** Draw a single structural girder (dark steel frame + cross-brace) in a cell. */
  private drawGirder(x: number, y: number, cell: number): void {
    const { ctx } = this;
    const t = Math.max(1, cell * 0.09); // beam thickness
    ctx.fillStyle = GIRDER_COLOR;
    // Outer frame (the steel beams).
    ctx.fillRect(x, y, cell, t); // top
    ctx.fillRect(x, y + cell - t, cell, t); // bottom
    ctx.fillRect(x, y, t, cell); // left
    ctx.fillRect(x + cell - t, y, t, cell); // right
    // Thin top highlight for a bit of metallic sheen.
    ctx.fillStyle = GIRDER_HILITE;
    ctx.fillRect(x, y, cell, Math.max(1, t * 0.4));
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
      // Grass + path only about one tile deep; the ground shows below it.
      const depth = Math.min(camera.groundMargin, cell);
      ctx.fillStyle = "#2f6b3a";
      ctx.fillRect(leftScreen, groundY, plotPxW, depth);
      ctx.fillStyle = "#3a7d46"; // lighter grass at the surface
      ctx.fillRect(leftScreen, groundY, plotPxW, 3);
      ctx.fillStyle = "#8a6a3a"; // a footpath through the middle
      ctx.fillRect(leftScreen + plotPxW * 0.45, groundY, plotPxW * 0.1, depth);
      // Trees rise ABOVE the ground line.
      for (const f of [0.18, 0.36, 0.62, 0.82]) {
        const tx = leftScreen + plotPxW * f;
        ctx.fillStyle = "#5a3f28"; // trunk
        ctx.fillRect(tx - cell * 0.03, groundY - cell * 0.4, cell * 0.06, cell * 0.4);
        ctx.fillStyle = "#3f9a52"; // canopy
        ctx.beginPath();
        ctx.arc(tx, groundY - cell * 0.5, cell * 0.28, 0, Math.PI * 2);
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

    // Girder tool: a single structural cell, with a live price for this floor.
    if (tool === "girder") {
      if (plot.ownerId !== localId) return;
      const gx = camera.worldToScreenX(leftWorld + hover.col * CELL_SIZE);
      const gy = camera.rowTopScreenY(hover.row);
      const blocked =
        hover.col >= plot.cols ||
        hover.row >= MAX_ROWS ||
        hasGirder(plot, hover.col, hover.row) ||
        !girderSupported(plot, hover.col, hover.row);
      ctx.fillStyle = blocked ? "rgba(200,70,70,0.30)" : "rgba(150,160,175,0.45)";
      ctx.fillRect(gx + 1, gy + 1, cell - 2, cell - 2);
      ctx.strokeStyle = blocked ? "#c84646" : GIRDER_COLOR;
      ctx.lineWidth = 2;
      ctx.strokeRect(gx + 1, gy + 1, cell - 2, cell - 2);
      if (!blocked) this.drawPriceTag(`$${girderCost(hover.row)}`, gx + cell / 2, gy - 2);
      return;
    }

    // Destroy tool: highlight the room (or bare girder) that would be removed.
    if (tool === "destroy") {
      if (plot.ownerId !== localId) return;
      const u = unitAt(plot, hover.col, hover.row);
      if (u) {
        const x = camera.worldToScreenX(leftWorld + u.col * CELL_SIZE);
        const y = camera.rowTopScreenY(u.row);
        const w = u.width * cell;
        ctx.fillStyle = "rgba(220,70,70,0.32)";
        ctx.fillRect(x + 1, y + 1, w - 2, cell - 2);
        ctx.strokeStyle = "#e8776f";
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, w - 2, cell - 2);
      } else if (hasGirder(plot, hover.col, hover.row)) {
        const gx = camera.worldToScreenX(leftWorld + hover.col * CELL_SIZE);
        const gy = camera.rowTopScreenY(hover.row);
        ctx.fillStyle = "rgba(220,70,70,0.28)";
        ctx.fillRect(gx + 1, gy + 1, cell - 2, cell - 2);
        ctx.strokeStyle = "#e8776f";
        ctx.lineWidth = 2;
        ctx.strokeRect(gx + 1, gy + 1, cell - 2, cell - 2);
      }
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
    if (!blocked) this.drawPriceTag(`$${def.cost.toLocaleString()}`, x + wpx / 2, y - 2);
  }
}

/** Group a plot's elevators into contiguous vertical runs per column. */
function elevatorRuns(plot: Plot): { col: number; from: number; to: number }[] {
  const byCol = new Map<number, number[]>();
  for (const u of plot.units) {
    if (u.kind !== "elevator") continue;
    const rows = byCol.get(u.col) ?? [];
    rows.push(u.row);
    byCol.set(u.col, rows);
  }
  const runs: { col: number; from: number; to: number }[] = [];
  for (const [col, rows] of byCol) {
    rows.sort((a, b) => a - b);
    let from = rows[0];
    let prev = rows[0];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i] === prev + 1) {
        prev = rows[i];
      } else {
        runs.push({ col, from, to: prev });
        from = rows[i];
        prev = rows[i];
      }
    }
    runs.push({ col, from, to: prev });
  }
  return runs;
}

/** Heatmap cell color: t=0 red (bad) -> t=1 green (good). */
function heatColor(t: number): string {
  const tt = Math.max(0, Math.min(1, t));
  const r = Math.round(230 - 130 * tt);
  const g = Math.round(80 + 140 * tt);
  return `rgba(${r},${g},80,0.42)`;
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
