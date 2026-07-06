import {
  CELL_SIZE,
  ELEVATOR_CAR_COST,
  MAX_DEPTH,
  MAX_ROWS,
  SUBWAY_ROW,
  UNIT_DEFS,
} from "../game/constants";
import type { GameState, Plot } from "../game/types";
import { unitAt, hasGirder, girderSupported } from "../game/reducer";
import {
  elevatorRuns,
  runContaining,
  carsInRun,
  autoCarNeeded,
  stepCar,
  MAX_CARS_PER_SHAFT,
} from "../game/elevator";
import { claimCost, girderCost, undergroundMultiplier } from "../game/economy";
import { featureLabel } from "../game/features";
import { facadeById, type Facade } from "../game/facades";
import { heatT, type HeatmapKind } from "../game/heatmaps";
import { skyState } from "../game/clock";
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

/** What the player currently has selected: a build unit, girder, elevator car, claim, destroy, or nothing. */
export type Tool = keyof typeof UNIT_DEFS | "claim" | "girder" | "elevatorCar" | "destroy" | null;

/** A brief floating "-$X" / "+$X" label at the cursor after a money change. */
interface Popup {
  x: number;
  y: number;
  text: string;
  color: string;
  born: number;
}
const POPUP_LIFE_MS = 950;

/** A 2D point in screen space (used by the perspective room interiors). */
interface Pt {
  x: number;
  y: number;
}

/**
 * A perspective "room shell": the drawn empty box plus parametric helpers to
 * place fixtures on its surfaces. `wall(f,g)` maps the back wall (f=left→right,
 * g=top→bottom); `ceil`/`floor(f,g)` map those planes (g=front→back).
 */
interface RoomShell {
  quad(pts: Pt[], fill: string): void;
  lp(a: Pt, b: Pt, f: number): Pt;
  wall(f: number, g: number): Pt;
  ceil(f: number, g: number): Pt;
  floor(f: number, g: number): Pt;
  base: number[];
  w: number;
}

/** Steel-frame color for structural girders. */
const GIRDER_COLOR = "#5c6470";
/** Lighter edge highlight so the steel beams read against the dark plot. */
const GIRDER_HILITE = "#7a828f";

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private popups: Popup[] = [];
  /** Current sky colours (top + horizon) — used to fill transparent windows. */
  private skyTop: number[] = [120, 150, 190];
  private skyBottom: number[] = [90, 120, 160];
  /** Current backdrop layer ids — drawn (small) through room windows too. */
  private bgNear = "none";
  private bgFar = "clear";
  /** Smoothly-animated car positions (per car id), advanced every frame. */
  private carAnim = new Map<string, { pos: number; dir: number }>();

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
    girderStyle = "steel",
    dtMs = 0,
  ): void {
    const { ctx, camera } = this;
    const w = camera.viewW;
    const h = camera.viewH;
    const groundY = camera.groundScreenY; // follows vertical pan (offsetY)

    // Cars move continuously (independent of the economy tick), scaled by speed.
    this.bgNear = state.config.backgroundNear ?? "none";
    this.bgFar = state.config.backgroundFar ?? "clear";
    this.advanceCarAnim(state, (dtMs / 1000) * (state.speed || 1));

    // Latitude + season drive the sky (day/night lengths shift through the year).
    const { day, twilight } = skyState(state.tick, state.config.latitude ?? 0);

    const top = mix([9, 12, 24], [40, 92, 150], day);
    let bottom = mix([22, 30, 48], [120, 158, 196], day);
    bottom = mix(bottom, [205, 115, 72], twilight * 0.55); // warm horizon at dawn/dusk
    // Stash for the transparent room windows (they show this same live sky).
    this.skyTop = top;
    this.skyBottom = bottom;
    const sky = ctx.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0, rgb(top));
    sky.addColorStop(1, rgb(bottom));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Backdrop behind the buildings (far horizon layer, then the nearer layer).
    this.drawBackdrop(state.config.backgroundFar ?? "clear", state.config.backgroundNear ?? "none", groundY, day);

    // Ground + underground earth: a brown that darkens with depth, all the way
    // down to (and past) the reserved subway level so no sky shows below.
    const cell = camera.scale(CELL_SIZE);
    const subwayTop = camera.rowTopScreenY(SUBWAY_ROW);
    const earthBottom = subwayTop + cell;
    const earth = ctx.createLinearGradient(0, groundY, 0, earthBottom);
    earth.addColorStop(0, "#3a2a1b"); // topsoil
    earth.addColorStop(0.5, "#241811");
    earth.addColorStop(1, "#0c0805"); // near-black deep down
    ctx.fillStyle = earth;
    ctx.fillRect(0, groundY, w, Math.max(0, h - groundY));
    // Reserved subway level (row SUBWAY_ROW).
    ctx.fillStyle = "#0d1319";
    ctx.fillRect(0, subwayTop, w, cell);
    ctx.fillStyle = "rgba(120,140,160,0.30)"; // rails hint
    ctx.fillRect(0, subwayTop + cell * 0.42, w, Math.max(1, cell * 0.05));
    ctx.fillRect(0, subwayTop + cell * 0.62, w, Math.max(1, cell * 0.05));
    // Surface strip.
    ctx.fillStyle = "#2a2018";
    ctx.fillRect(0, groundY, w, 4);
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

    // Night dims the whole scene (ghosts + popups stay bright, drawn after).
    if (day < 0.35) {
      ctx.fillStyle = `rgba(8,12,28,${((0.35 - day) * 1.15).toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
    }

    if (hover) this.drawHoverGhost(state, localPlayerId, hover, tool, girderStyle);

    this.drawPopups();
  }

  /**
   * Advance each elevator car's animated position by `dtSec` (already scaled by
   * game speed). Purely visual smoothing — the authoritative car entity keeps
   * its own position for future passenger logic. Prunes cars that vanished.
   */
  private advanceCarAnim(state: GameState, dtSec: number): void {
    const live = new Set<string>();
    for (const key of Object.keys(state.plots)) {
      const plot = state.plots[Number(key)];
      if (!plot.cars || plot.cars.length === 0) continue;
      const runs = elevatorRuns(plot);
      for (const car of plot.cars) {
        live.add(car.id);
        let a = this.carAnim.get(car.id);
        if (!a) {
          a = { pos: car.position, dir: car.dir || 1 };
          this.carAnim.set(car.id, a);
        }
        const run =
          runs.find((r) => r.col === car.col && Math.round(a!.pos) >= r.from && Math.round(a!.pos) <= r.to) ??
          runs.find((r) => r.col === car.col);
        if (!run) continue;
        if (dtSec > 0) {
          const next = stepCar(a.pos, a.dir, run.from, run.to, Math.min(dtSec, 0.1)); // clamp long frame gaps
          a.pos = next.pos;
          a.dir = next.dir;
        } else {
          a.pos = Math.max(run.from, Math.min(run.to, a.pos));
        }
      }
    }
    for (const id of [...this.carAnim.keys()]) if (!live.has(id)) this.carAnim.delete(id);
  }

  /**
   * Draw the two backdrop layers behind the buildings: the distant FAR layer
   * first (hazier, slow parallax), then the nearer NEAR layer (darker, faster
   * parallax). Both scale with zoom so they read as part of the world.
   */
  private drawBackdrop(far: string, near: string, groundY: number, day: number): void {
    this.drawFar(far, groundY, day);
    this.drawNear(near, groundY, day);
  }

  /** Distant horizon layer: ocean, mountains, hills, or open sky. */
  private drawFar(kind: string, groundY: number, day: number): void {
    if (kind === "clear") return;
    const { ctx, camera } = this;
    const w = camera.viewW;
    const z = camera.zoom;
    // Far things are hazier — blended toward the sky and lightened by daylight.
    const haze = (base: number[]): string => rgb(mix(mix(base, [120, 140, 165], 0.4), [255, 255, 255], day * 0.14));
    const px = -((camera.offsetX * 0.05) % (400 * z)); // slow parallax

    if (kind === "mountains") {
      ctx.fillStyle = haze([54, 62, 82]);
      const step = 300 * z;
      // Gentle ridgeline — low, rounded peaks (not jagged).
      for (let i = -1; i * step + px < w + step; i++) {
        const bx = i * step + px;
        this.peak(bx + 20 * z, groundY, 170 * z, 70 * z);
        this.peak(bx + 170 * z, groundY, 150 * z, 96 * z);
      }
    } else if (kind === "hills") {
      ctx.fillStyle = haze([48, 68, 56]);
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      for (let x = 0; x <= w; x += 12) {
        const y =
          groundY - 34 * z - 22 * z * Math.sin((x + px) / (110 * z)) - 10 * z * Math.sin((x + px) / (43 * z));
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, groundY);
      ctx.closePath();
      ctx.fill();
    } else if (kind === "ocean") {
      // A calm sea meeting the sky at a low horizon, with a few glints.
      const horizon = groundY - 30 * z;
      const sea = ctx.createLinearGradient(0, horizon, 0, groundY);
      sea.addColorStop(0, haze([46, 86, 120]));
      sea.addColorStop(1, haze([26, 58, 88]));
      ctx.fillStyle = sea;
      ctx.fillRect(0, horizon, w, groundY - horizon);
      ctx.fillStyle = `rgba(210,230,245,${(0.10 + day * 0.14).toFixed(3)})`;
      for (let x = ((px * 0.5) % (60 * z)) - 60 * z; x < w; x += 60 * z) {
        ctx.fillRect(x, horizon + 12 * z, 26 * z, Math.max(1, 1.5 * z));
        ctx.fillRect(x + 30 * z, horizon + 20 * z, 16 * z, Math.max(1, 1.5 * z));
      }
    }
  }

  /** Nearer layer just behind the towers: skyline, historic rooftops, palms, firs. */
  private drawNear(kind: string, groundY: number, day: number): void {
    if (kind === "none") return;
    const { ctx, camera } = this;
    const w = camera.viewW;
    const z = camera.zoom;
    const shade = (base: number[]): string => rgb(mix(base, [255, 255, 255], day * 0.1));
    const px = -((camera.offsetX * 0.16) % (200 * z)); // faster parallax than the far layer

    if (kind === "skyline") {
      ctx.fillStyle = shade([24, 33, 52]);
      let x = px - 200 * z;
      let seed = 1;
      while (x < w + 60 * z) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const bw = (26 + (seed % 34)) * z;
        const bh = (60 + ((seed >> 5) % 170)) * z;
        ctx.fillRect(x, groundY - bh, bw, bh);
        x += bw + (6 + ((seed >> 3) % 10)) * z;
      }
    } else if (kind === "oldtown") {
      // A row of low pitched-roof buildings (historic European quarter).
      ctx.fillStyle = shade([46, 40, 44]);
      let x = px - 160 * z;
      let seed = 7;
      while (x < w + 60 * z) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const bw = (40 + (seed % 30)) * z;
        const bh = (46 + ((seed >> 5) % 60)) * z;
        this.gableHouse(x, groundY, bw, bh, z);
        x += bw + 2 * z;
      }
    } else if (kind === "palms") {
      ctx.fillStyle = shade([56, 52, 36]);
      ctx.fillRect(0, groundY - 16 * z, w, 16 * z);
      ctx.fillStyle = shade([26, 42, 36]);
      const step = 180 * z;
      for (let i = -1; i * step + px < w + step; i++) this.palm(i * step + px + 60 * z, groundY - 16 * z, z);
    } else if (kind === "firs") {
      // An evergreen forest silhouette — stacked triangles.
      ctx.fillStyle = shade([26, 42, 34]);
      const step = 46 * z;
      for (let i = -1; i * step + px < w + step; i++) {
        const fx = i * step + px + (((i * 2654435761) >>> 6) % 18) * z;
        const fh = (60 + (((i * 40503) >>> 3) % 46)) * z;
        this.fir(fx, groundY, fh, z);
      }
    }
  }

  /** One gable-roofed townhouse for the historic-quarter backdrop. */
  private gableHouse(x: number, groundY: number, bw: number, bh: number, z: number): void {
    const { ctx } = this;
    const roofH = Math.min(bh * 0.5, 24 * z);
    ctx.fillRect(x, groundY - bh, bw, bh); // wall
    ctx.beginPath(); // pitched roof
    ctx.moveTo(x - 2 * z, groundY - bh);
    ctx.lineTo(x + bw / 2, groundY - bh - roofH);
    ctx.lineTo(x + bw + 2 * z, groundY - bh);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(x + bw * 0.7, groundY - bh - roofH * 0.6, 4 * z, roofH * 0.7); // chimney
  }

  /** One fir/pine tree silhouette (stacked triangles). */
  private fir(x: number, groundY: number, height: number, z: number): void {
    const { ctx } = this;
    const halfW = height * 0.32;
    ctx.beginPath();
    for (let tier = 0; tier < 3; tier++) {
      const topY = groundY - height + (tier * height) / 4;
      const baseY = groundY - height * 0.28 + (tier * height) / 4;
      const hw = halfW * (0.55 + tier * 0.22);
      ctx.moveTo(x - hw, baseY);
      ctx.lineTo(x, topY);
      ctx.lineTo(x + hw, baseY);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(x - 2 * z, groundY - height * 0.28, 4 * z, height * 0.28); // trunk
  }

  private peak(cx: number, groundY: number, halfW: number, height: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(cx - halfW, groundY);
    ctx.lineTo(cx, groundY - height);
    ctx.lineTo(cx + halfW, groundY);
    ctx.closePath();
    ctx.fill();
  }

  private palm(x: number, baseY: number, z: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle as string;
    ctx.lineWidth = 4 * z;
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.quadraticCurveTo(x + 8 * z, baseY - 40 * z, x + 4 * z, baseY - 78 * z);
    ctx.stroke();
    ctx.lineWidth = 3 * z;
    const topY = baseY - 78 * z;
    for (const [dx, dy] of [[-34, -12], [-20, -30], [20, -30], [34, -12], [0, -34]] as const) {
      ctx.beginPath();
      ctx.moveTo(x + 4 * z, topY);
      ctx.quadraticCurveTo(x + 4 * z + dx * 0.5 * z, topY + dy * z, x + 4 * z + dx * z, topY + (dy + 14) * z);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Tint each STRUCTURAL cell (a girder or room) of an owned plot by a
   * normalized heatmap rating. Empty airspace is left untinted.
   */
  private drawHeatmap(plot: Plot, kind: HeatmapKind): void {
    const { ctx, camera } = this;
    const cell = camera.scale(CELL_SIZE);
    const leftScreen = camera.worldToScreenX(camera.plotLeftWorldX(plot.index));
    if (leftScreen + plot.cols * cell < 0 || leftScreen > camera.viewW) return;

    // Collect the cells that have structure (deduped).
    const cells = new Set<number>();
    const key = (c: number, r: number): number => r * 1000 + c;
    for (const g of plot.girders ?? []) cells.add(key(g.col, g.row));
    for (const u of plot.units) {
      for (let c = u.col; c < u.col + u.width; c++) cells.add(key(c, u.row));
    }

    for (const k of cells) {
      const row = Math.floor(k / 1000);
      const col = k % 1000;
      const x = camera.worldToScreenX(camera.plotLeftWorldX(plot.index) + col * CELL_SIZE);
      const y = camera.rowTopScreenY(row);
      ctx.fillStyle = heatColor(heatT(kind, plot, col, row));
      ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
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

    // Structural girders (drawn first; rooms are painted over them). Each girder
    // carries a cosmetic facade style that tints its steel.
    for (const g of plot.girders ?? []) {
      const gx = camera.worldToScreenX(leftWorld + g.col * CELL_SIZE);
      const gy = camera.rowTopScreenY(g.row);
      // Underground girders sit in an excavated cavity, not solid earth.
      if (g.row < 0) {
        ctx.fillStyle = "#1a1e26";
        ctx.fillRect(gx + 1, gy + 1, cell - 2, cell - 2);
      }
      this.drawGirder(gx, gy, cell, facadeById(g.style));
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

      // Every room type except infrastructure (lobby / elevator) is drawn as an
      // empty perspective interior; the rest keep a flat colored cell. The
      // room's facade/windows come from the girder it's built on.
      const hasInterior = unit.kind !== "lobby";
      if (hasInterior) {
        const g = (plot.girders ?? []).find((gg) => gg.col === unit.col && gg.row === unit.row);
        this.drawRoomInterior(unit.kind, x + 1, y + 1, wpx - 2, cell - 2, facadeById(g?.style), unit.row < 0);
      } else {
        ctx.fillStyle = def.color;
        ctx.fillRect(x + 1, y + 1, wpx - 2, cell - 2);
      }

      // Owner-color band along the top edge so ownership reads at a glance.
      ctx.fillStyle = ownerColor;
      ctx.fillRect(x + 1, y + 1, wpx - 2, bandH);

      // Occupancy shading for revenue units (flat-drawn rooms only).
      if (def.incomeAtFull > 0 && !hasInterior) {
        ctx.fillStyle = "rgba(255,220,120,0.4)";
        const barH = Math.max(3, cell * 0.16);
        const litW = (wpx - 6) * unit.occupancy;
        ctx.fillRect(x + 3, y + cell - barH - 2, litW, barH);
      }

      if (showLabels) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.font = `${Math.min(11, cell * 0.24)}px system-ui, sans-serif`;
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        ctx.fillText(def.label, x + 4, y + bandH + 3);
      }
    }

    // Elevator shafts (the structure): a continuous rail channel per run.
    for (const run of elevatorRuns(plot)) {
      const x = camera.worldToScreenX(leftWorld + run.col * CELL_SIZE);
      const yTop = camera.rowTopScreenY(run.to);
      const yBottom = camera.rowTopScreenY(run.from) + cell;
      this.drawElevatorShaft(x, yTop, cell, yBottom - yTop, ownerColor, bandH);
    }
    // Elevator cars ride the shafts at their smoothly-animated positions.
    for (const car of plot.cars ?? []) {
      const anim = this.carAnim.get(car.id);
      const pos = anim ? anim.pos : car.position;
      const x = camera.worldToScreenX(leftWorld + car.col * CELL_SIZE);
      const y = camera.groundScreenY - (pos + 1) * cell;
      this.drawElevatorCar(x, y, cell);
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
   * Draw an elevator shaft's structure: a dark rail channel with two guide
   * rails. Cars (drawn separately) ride inside it. An empty shaft reads as
   * "needs a car".
   */
  private drawElevatorShaft(
    x: number,
    yTop: number,
    cell: number,
    height: number,
    ownerColor: string,
    bandH: number,
  ): void {
    const { ctx } = this;
    const w = cell;
    ctx.fillStyle = "#2f343c"; // dark shaft channel
    ctx.fillRect(x + 1, yTop + 1, w - 2, height - 2);
    ctx.fillStyle = "#575d66"; // guide rails
    ctx.fillRect(x + 3, yTop + 2, 2, height - 4);
    ctx.fillRect(x + w - 5, yTop + 2, 2, height - 4);
    // Owner-color band along the very top of the run.
    ctx.fillStyle = ownerColor;
    ctx.fillRect(x + 1, yTop + 1, w - 2, bandH);
  }

  /** Draw one elevator car (a metallic cabin) at a screen position in its shaft. */
  private drawElevatorCar(x: number, y: number, cell: number): void {
    const { ctx } = this;
    const inset = Math.max(2, cell * 0.14);
    const cx = x + inset;
    const cy = y + 2;
    const cw = cell - inset * 2;
    const chH = cell - 4;
    ctx.fillStyle = "#aab0b8"; // cabin body
    ctx.fillRect(cx, cy, cw, chH);
    ctx.fillStyle = "#c9ced4"; // top highlight
    ctx.fillRect(cx, cy, cw, Math.max(1, chH * 0.16));
    ctx.fillStyle = "#41474f"; // door seam down the middle
    ctx.fillRect(cx + cw / 2 - 1, cy + 2, 2, chH - 4);
    ctx.strokeStyle = "#6b7280";
    ctx.lineWidth = 1;
    ctx.strokeRect(cx + 0.5, cy + 0.5, cw - 1, chH - 1);
  }

  /**
   * Draw a room as an empty interior in a light 3-point perspective — the "empty
   * shell" of that room type before any tenants/customers move in. Falls back to
   * a flat fill for kinds that don't have bespoke art yet.
   */
  private drawRoomInterior(
    kind: keyof typeof UNIT_DEFS,
    x: number,
    y: number,
    w: number,
    h: number,
    facade: Facade,
    underground: boolean,
  ): void {
    switch (kind) {
      case "office":
        return this.drawOfficeInterior(x, y, w, h, facade, underground);
      case "medical":
        return this.drawMedicalInterior(x, y, w, h, facade, underground);
      case "apartment":
        return this.drawApartmentInterior(x, y, w, h, facade, underground);
      case "store":
        return this.drawStoreInterior(x, y, w, h, facade, underground);
      case "restaurant":
        return this.drawRestaurantInterior(x, y, w, h, facade, underground);
      case "hotel":
        return this.drawHotelInterior(x, y, w, h, facade, underground);
      default:
        this.ctx.fillStyle = UNIT_DEFS[kind].color;
        this.ctx.fillRect(x, y, w, h);
    }
  }

  // --- facade wall + transparent windows (shared by every room) --------------

  /**
   * Draw a room's facade windows on its (room-coloured) back wall. Only the
   * glass reflects the facade style — the wall between windows stays the room's
   * own colour (drawn by roomShell). Full-glass styles cover the whole wall.
   * Windows are transparent (filled with the LIVE sky, so you see sunrise /
   * sunset through them). Underground rooms get no windows at all.
   */
  private drawFacade(s: RoomShell, facade: Facade, underground: boolean): void {
    if (underground) return; // no view underground, ever
    const tint = facade.tint ?? 0;
    switch (facade.pattern) {
      case "full": // full glass / black-tinted — the entire back wall is glass
        this.skyWindow(s, 0.03, 0.97, 0.04, 0.96, tint, facade.frame, [0.25, 0.5, 0.75], [0.5]);
        break;
      case "xbrace": // full-wall glass with a steel X across it
        this.skyWindow(s, 0.03, 0.97, 0.04, 0.96, tint, facade.frame, [0.5], [0.5]);
        this.wallX(s, 0.03, 0.97, 0.04, 0.96, facade.girder);
        break;
      case "vgrid": // curtain wall — a row of tall, narrow vertical panes
        for (const [f0, f1] of pairs([0.05, 0.185, 0.32, 0.455, 0.59, 0.725, 0.86, 0.95]))
          this.skyWindow(s, f0 + 0.006, f1 - 0.006, 0.07, 0.62, tint, facade.frame, [], []);
        break;
      case "vrect": // brick — a row of tall, narrow (vertical) windows
        for (const cf of [0.2, 0.4, 0.6, 0.8])
          this.skyWindow(s, cf - 0.06, cf + 0.06, 0.1, 0.6, tint, facade.frame, [], [0.5]);
        break;
      case "arch": // art-deco — very tall windows with a lintel cap
        for (const cf of [0.22, 0.5, 0.78]) {
          this.skyWindow(s, cf - 0.08, cf + 0.08, 0.08, 0.66, tint, facade.frame, [], [0.55]);
          this.wallBand(s, cf - 0.1, cf + 0.1, 0.04, 0.08, facade.frame); // lintel cap
        }
        break;
      default: // "rect" — punched rectangular windows (concrete, steel)
        for (const cf of [0.22, 0.5, 0.78])
          this.skyWindow(s, cf - 0.12, cf + 0.12, 0.16, 0.46, tint, facade.frame, [0.5], []);
        break;
    }
  }

  /**
   * A transparent window on the back wall, filled with the live sky (+tint),
   * with a frame plus optional vertical (`vMull`) and horizontal (`hMull`)
   * mullions given as fractions across the window.
   */
  private skyWindow(
    s: RoomShell,
    f0: number,
    f1: number,
    g0: number,
    g1: number,
    tint: number,
    frame: string,
    vMull: number[],
    hMull: number[],
  ): void {
    const { ctx } = this;
    const pts = [s.wall(f0, g0), s.wall(f1, g0), s.wall(f1, g1), s.wall(f0, g1)];
    const path = (): void => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts) ctx.lineTo(p.x, p.y);
      ctx.closePath();
    };
    // Sky (live day/night gradient).
    const topMid = s.lp(pts[0], pts[1], 0.5);
    const botMid = s.lp(pts[3], pts[2], 0.5);
    const grad = ctx.createLinearGradient(topMid.x, topMid.y, botMid.x, botMid.y);
    grad.addColorStop(0, rgb(this.skyTop));
    grad.addColorStop(1, rgb(this.skyBottom));
    path();
    ctx.fillStyle = grad;
    ctx.fill();
    // The world outside — both backdrop layers, clipped to the glass. Skipped
    // when the window is too small to be worth the polygons.
    if (s.w >= 46) {
      ctx.save();
      path();
      ctx.clip();
      this.windowBackdrop(s, f0, f1, g0, g1);
      ctx.restore();
    }
    // Tinted glass darkens the whole view behind it.
    if (tint > 0) {
      path();
      ctx.fillStyle = `rgba(8,10,14,${tint})`;
      ctx.fill();
    }
    // Frame + mullions.
    ctx.strokeStyle = frame;
    ctx.lineWidth = Math.max(0.6, s.w * 0.012);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.lineTo(pts[0].x, pts[0].y);
    for (const f of vMull) {
      const ff = f0 + (f1 - f0) * f;
      const a = s.wall(ff, g0), b = s.wall(ff, g1);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    for (const g of hMull) {
      const gg = g0 + (g1 - g0) * g;
      const a = s.wall(f0, gg), b = s.wall(f1, gg);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }

  /**
   * Draw a small view of the city's two backdrop layers inside a window (far
   * horizon silhouette, then a nearer one), so looking out shows the same world
   * as the main backdrop. Colours blend with the live sky, so it darkens at
   * night too. Coordinates are given in window-local fractions (0..1).
   */
  private windowBackdrop(s: RoomShell, f0: number, f1: number, g0: number, g1: number): void {
    const { ctx } = this;
    const pt = (ff: number, gg: number): Pt => s.wall(f0 + (f1 - f0) * ff, g0 + (g1 - g0) * gg);
    const poly = (coords: Pt[]): void => {
      ctx.beginPath();
      ctx.moveTo(coords[0].x, coords[0].y);
      for (let i = 1; i < coords.length; i++) ctx.lineTo(coords[i].x, coords[i].y);
      ctx.closePath();
      ctx.fill();
    };
    const gh = 0.62; // horizon within the window

    // Far layer.
    if (this.bgFar === "mountains") {
      ctx.fillStyle = rgb(mix(this.skyBottom, [90, 98, 118], 0.55));
      poly([pt(0, gh), pt(0.28, gh - 0.26), pt(0.5, gh - 0.05), pt(0.76, gh - 0.32), pt(1, gh - 0.02), pt(1, 1), pt(0, 1)]);
    } else if (this.bgFar === "hills") {
      ctx.fillStyle = rgb(mix(this.skyBottom, [72, 94, 80], 0.5));
      poly([pt(0, gh), pt(0.3, gh - 0.1), pt(0.6, gh - 0.03), pt(1, gh - 0.12), pt(1, 1), pt(0, 1)]);
    } else if (this.bgFar === "ocean") {
      ctx.fillStyle = rgb(mix(this.skyBottom, [40, 84, 122], 0.6));
      poly([pt(0, gh), pt(1, gh), pt(1, 1), pt(0, 1)]);
    }

    // Near layer (darker, closer).
    ctx.fillStyle = rgb(mix(this.skyBottom, [18, 24, 34], 0.78));
    const nh = gh + 0.06;
    if (this.bgNear === "skyline") {
      for (const [a, hh] of [[0.04, 0.3], [0.2, 0.52], [0.38, 0.22], [0.54, 0.46], [0.72, 0.32], [0.88, 0.5]] as const)
        poly([pt(a, nh - hh), pt(a + 0.11, nh - hh), pt(a + 0.11, 1), pt(a, 1)]);
    } else if (this.bgNear === "firs") {
      for (const a of [0.14, 0.38, 0.62, 0.86])
        poly([pt(a - 0.09, nh), pt(a, nh - 0.42), pt(a + 0.09, nh), pt(a + 0.03, 1), pt(a - 0.03, 1)]);
    } else if (this.bgNear === "palms") {
      for (const a of [0.28, 0.72])
        poly([pt(a - 0.09, nh - 0.26), pt(a, nh - 0.42), pt(a + 0.09, nh - 0.26), pt(a + 0.03, 1), pt(a - 0.03, 1)]);
    } else if (this.bgNear === "oldtown") {
      for (const a of [0.06, 0.32, 0.58, 0.84])
        poly([pt(a, nh - 0.16), pt(a + 0.08, nh - 0.3), pt(a + 0.16, nh - 0.16), pt(a + 0.16, 1), pt(a, 1)]);
    }
  }

  /** A steel X-brace drawn across a window region (glass X-brace facade). */
  private wallX(s: RoomShell, f0: number, f1: number, g0: number, g1: number, color: string): void {
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, s.w * 0.02);
    ctx.beginPath();
    let a = s.wall(f0, g0), b = s.wall(f1, g1);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    a = s.wall(f1, g0);
    b = s.wall(f0, g1);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  /**
   * Build + draw the empty perspective shell (floor, ceiling, two side walls,
   * back wall) shaded from `base`, and return helpers to place fixtures on it.
   */
  private roomShell(
    x: number,
    y: number,
    w: number,
    h: number,
    base: number[],
    opt: { floor?: string; ceiling?: string; back?: string } = {},
  ): RoomShell {
    const { ctx } = this;
    const vp: Pt = { x: x + w * 0.54, y: y + h * 0.46 }; // slightly off-centre → subtle 3-point feel
    const depth = 0.52;
    const to = (p: Pt): Pt => ({ x: p.x + (vp.x - p.x) * depth, y: p.y + (vp.y - p.y) * depth });
    const TL: Pt = { x, y }, TR: Pt = { x: x + w, y }, BR: Pt = { x: x + w, y: y + h }, BL: Pt = { x, y: y + h };
    const bTL = to(TL), bTR = to(TR), bBR = to(BR), bBL = to(BL);
    const lp = (a: Pt, b: Pt, f: number): Pt => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
    const quad = (pts: Pt[], fill: string): void => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    // The five interior surfaces.
    quad([BL, BR, bBR, bBL], opt.floor ?? rgb(mix(base, [16, 18, 24], 0.55))); // floor
    quad([TL, TR, bTR, bTL], opt.ceiling ?? rgb(mix(base, [245, 248, 252], 0.52))); // ceiling
    quad([TL, bTL, bBL, BL], rgb(mix(base, [8, 12, 20], 0.44))); // left wall (shadow side)
    quad([TR, bTR, bBR, BR], rgb(mix(base, [8, 12, 20], 0.22))); // right wall
    quad([bTL, bTR, bBR, bBL], opt.back ?? rgb(mix(base, [236, 241, 247], 0.3))); // back wall
    // Baseboard seam where the back wall meets the floor.
    ctx.strokeStyle = rgb(mix(base, [0, 0, 0], 0.5));
    ctx.lineWidth = Math.max(0.5, w * 0.01);
    ctx.beginPath();
    ctx.moveTo(bBL.x, bBL.y);
    ctx.lineTo(bBR.x, bBR.y);
    ctx.stroke();

    return {
      quad,
      lp,
      wall: (f, g) => lp(lp(bTL, bTR, f), lp(bBL, bBR, f), g),
      ceil: (f, g) => lp(lp(TL, TR, f), lp(bTL, bTR, f), g),
      floor: (f, g) => lp(lp(BL, BR, f), lp(bBL, bBR, f), g),
      base,
      w,
    };
  }

  // --- room fixtures (all drawn on the shell's perspective surfaces) ---------

  /** A filled rectangle on the back wall (counters, cabinets, signs, curtains). */
  private wallBand(s: RoomShell, f0: number, f1: number, g0: number, g1: number, color: string): void {
    s.quad([s.wall(f0, g0), s.wall(f1, g0), s.wall(f1, g1), s.wall(f0, g1)], color);
  }

  /** Horizontal lines across the back wall (shelving). */
  private wallLines(s: RoomShell, f0: number, f1: number, gs: number[], color: string): void {
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(0.6, s.w * 0.012);
    ctx.beginPath();
    for (const g of gs) {
      const a = s.wall(f0, g), b = s.wall(f1, g);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }

  /** Vertical dividers on the back wall (shelf uprights). */
  private wallVLines(s: RoomShell, fs: number[], g0: number, g1: number, color: string): void {
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(0.5, s.w * 0.01);
    ctx.beginPath();
    for (const f of fs) {
      const a = s.wall(f, g0), b = s.wall(f, g1);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }

  /** Recessed rectangular ceiling light panels at the given centre fractions. */
  private ceilingPanels(s: RoomShell, cfs: number[]): void {
    for (const cf of cfs) {
      s.quad(
        [s.ceil(cf - 0.11, 0.5), s.ceil(cf + 0.11, 0.5), s.ceil(cf + 0.11, 0.92), s.ceil(cf - 0.11, 0.92)],
        "rgba(255,251,224,0.85)",
      );
    }
  }

  /** Small bright ceiling spots (retail track lighting). */
  private trackLights(s: RoomShell, fs: number[]): void {
    for (const f of fs) {
      s.quad(
        [s.ceil(f - 0.04, 0.55), s.ceil(f + 0.04, 0.55), s.ceil(f + 0.04, 0.72), s.ceil(f - 0.04, 0.72)],
        "rgba(255,250,220,0.9)",
      );
    }
  }

  /** Pendant lamps hanging from the ceiling (restaurant). */
  private pendantLights(s: RoomShell, fs: number[], color = "rgba(255,214,140,0.95)"): void {
    const { ctx } = this;
    for (const f of fs) {
      const top = s.ceil(f, 0.62);
      const at = s.lp(top, s.floor(f, 0.62), 0.3);
      ctx.strokeStyle = "rgba(20,20,25,0.6)";
      ctx.lineWidth = Math.max(0.5, s.w * 0.006);
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(at.x, at.y);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(at.x, at.y, Math.max(1.2, s.w * 0.028), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Empty open-plan office: bare carpet, the facade window wall, ceiling lights. */
  private drawOfficeInterior(x: number, y: number, w: number, h: number, facade: Facade, ug: boolean): void {
    const s = this.roomShell(x, y, w, h, [91, 143, 176]);
    this.drawFacade(s, facade, ug);
    this.ceilingPanels(s, [0.32, 0.68]);
  }

  /** Empty clinic: pale floor, a green cross low on the wall, ceiling panels. */
  private drawMedicalInterior(x: number, y: number, w: number, h: number, facade: Facade, ug: boolean): void {
    const base = [75, 181, 166];
    const s = this.roomShell(x, y, w, h, base, { floor: rgb(mix(base, [222, 230, 228], 0.6)) });
    this.drawFacade(s, facade, ug);
    this.wallBand(s, 0.44, 0.56, 0.62, 0.92, "rgba(40,160,96,0.92)"); // cross (vertical)
    this.wallBand(s, 0.36, 0.64, 0.7, 0.8, "rgba(40,160,96,0.92)"); // cross (horizontal)
    this.ceilingPanels(s, [0.3, 0.7]);
  }

  /** Empty flat: wood floor, the facade window, a built-in kitchenette below. */
  private drawApartmentInterior(x: number, y: number, w: number, h: number, facade: Facade, ug: boolean): void {
    const base = [123, 171, 110];
    const s = this.roomShell(x, y, w, h, base, { floor: rgb(mix([120, 82, 48], [58, 36, 18], 0.4)) });
    this.drawFacade(s, facade, ug);
    this.wallBand(s, 0.08, 0.7, 0.72, 0.82, "rgba(58,42,30,0.92)"); // counter
    this.wallBand(s, 0.5, 0.66, 0.62, 0.72, "rgba(150,150,155,0.55)"); // stove/appliance
    this.wallBand(s, 0.74, 0.9, 0.58, 0.92, "rgba(210,214,218,0.5)"); // fridge
    this.trackLights(s, [0.5]);
  }

  /** Empty retail unit: polished floor, empty low shelving, track lights. */
  private drawStoreInterior(x: number, y: number, w: number, h: number, facade: Facade, ug: boolean): void {
    const base = [208, 138, 79];
    const s = this.roomShell(x, y, w, h, base, { floor: rgb(mix(base, [236, 226, 212], 0.62)) });
    this.drawFacade(s, facade, ug);
    this.wallLines(s, 0.1, 0.9, [0.62, 0.74, 0.86], "rgba(70,50,32,0.5)"); // shelves
    this.wallVLines(s, [0.3, 0.5, 0.7], 0.6, 0.9, "rgba(70,50,32,0.4)");
    this.trackLights(s, [0.25, 0.5, 0.75]);
  }

  /** Empty dining room: wood floor, a low back bar, hanging pendant lamps. */
  private drawRestaurantInterior(x: number, y: number, w: number, h: number, facade: Facade, ug: boolean): void {
    const base = [200, 90, 106];
    const s = this.roomShell(x, y, w, h, base, { floor: rgb(mix([110, 66, 40], [54, 32, 18], 0.4)) });
    this.drawFacade(s, facade, ug);
    this.wallBand(s, 0.08, 0.92, 0.72, 0.86, "rgba(48,30,26,0.95)"); // bar counter
    this.wallLines(s, 0.12, 0.88, [0.6, 0.68], "rgba(200,170,120,0.5)"); // bottle shelves
    this.pendantLights(s, [0.28, 0.5, 0.72]);
  }

  /** Empty hotel room: carpet, the facade window, an empty headboard + bed base. */
  private drawHotelInterior(x: number, y: number, w: number, h: number, facade: Facade, ug: boolean): void {
    const base = [106, 127, 192];
    const s = this.roomShell(x, y, w, h, base, { floor: rgb(mix(base, [42, 36, 54], 0.55)) });
    this.drawFacade(s, facade, ug);
    this.wallBand(s, 0.2, 0.8, 0.62, 0.72, "rgba(120,96,70,0.9)"); // headboard
    this.wallBand(s, 0.16, 0.84, 0.8, 0.92, "rgba(200,200,210,0.5)"); // bed linens hint
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

  /**
   * Draw a single structural girder (steel frame + cross-brace) in a cell,
   * tinted by its facade style so the bare frame previews the finished look.
   */
  private drawGirder(x: number, y: number, cell: number, facade?: Facade): void {
    const { ctx } = this;
    const beam = facade?.girder ?? GIRDER_COLOR;
    const hilite = facade ? rgb(mix(hexRgb(facade.girder), [255, 255, 255], 0.28)) : GIRDER_HILITE;
    const t = Math.max(1, cell * 0.09); // beam thickness
    ctx.fillStyle = beam;
    // Outer frame (the steel beams).
    ctx.fillRect(x, y, cell, t); // top
    ctx.fillRect(x, y + cell - t, cell, t); // bottom
    ctx.fillRect(x, y, t, cell); // left
    ctx.fillRect(x + cell - t, y, t, cell); // right
    // Thin top highlight for a bit of metallic sheen.
    ctx.fillStyle = hilite;
    ctx.fillRect(x, y, cell, Math.max(1, t * 0.4));
    // Diagonal cross-brace.
    ctx.strokeStyle = beam;
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
      // A channel exactly 5 tiles deep, bridged at the surface. (The earth below
      // it — rows -6 and the subway — is drawn by the global underground fill.)
      const depth = 5 * cell;
      const channelBottom = groundY + depth;
      // Carve the channel (under-bridge shadow) 5 tiles down.
      ctx.fillStyle = "#16232f";
      ctx.fillRect(leftScreen, groundY, plotPxW, depth);
      // Lowered water filling the lower part of the channel — bright at the
      // surface, fading to near-black in the deep.
      const waterY = groundY + depth * 0.42;
      const water = ctx.createLinearGradient(0, waterY, 0, channelBottom);
      water.addColorStop(0, "#3a7bb0");
      water.addColorStop(0.5, "#1b4062");
      water.addColorStop(1, "#060f1a");
      ctx.fillStyle = water;
      ctx.fillRect(leftScreen, waterY, plotPxW, channelBottom - waterY);
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
    girderStyle: string,
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

    // Girder tool: a single structural cell in the selected facade style, with a
    // live price for this floor.
    if (tool === "girder") {
      if (plot.ownerId !== localId) return;
      const gx = camera.worldToScreenX(leftWorld + hover.col * CELL_SIZE);
      const gy = camera.rowTopScreenY(hover.row);
      const blocked =
        hover.col >= plot.cols ||
        hover.row >= MAX_ROWS ||
        hover.row < -MAX_DEPTH ||
        hasGirder(plot, hover.col, hover.row) ||
        !girderSupported(plot, hover.col, hover.row);
      if (blocked) {
        ctx.fillStyle = "rgba(200,70,70,0.30)";
        ctx.fillRect(gx + 1, gy + 1, cell - 2, cell - 2);
        ctx.strokeStyle = "#c84646";
        ctx.lineWidth = 2;
        ctx.strokeRect(gx + 1, gy + 1, cell - 2, cell - 2);
      } else {
        ctx.globalAlpha = 0.72;
        this.drawGirder(gx, gy, cell, facadeById(girderStyle));
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#78dc78";
        ctx.lineWidth = 2;
        ctx.strokeRect(gx + 1, gy + 1, cell - 2, cell - 2);
        this.drawPriceTag(`$${girderCost(hover.row)}`, gx + cell / 2, gy - 2);
      }
      return;
    }

    // Elevator-car tool: must drop inside a shaft that isn't already full.
    if (tool === "elevatorCar") {
      if (plot.ownerId !== localId) return;
      const run = runContaining(plot, hover.col, hover.row);
      const blocked = !run || carsInRun(plot, run).length >= MAX_CARS_PER_SHAFT;
      const gx = camera.worldToScreenX(leftWorld + hover.col * CELL_SIZE);
      const gy = camera.rowTopScreenY(hover.row);
      if (blocked) {
        ctx.fillStyle = "rgba(200,70,70,0.30)";
        ctx.fillRect(gx + 1, gy + 1, cell - 2, cell - 2);
        ctx.strokeStyle = "#c84646";
        ctx.lineWidth = 2;
        ctx.strokeRect(gx + 1, gy + 1, cell - 2, cell - 2);
      } else {
        this.drawElevatorCar(gx, gy, cell);
        ctx.strokeStyle = "#78dc78";
        ctx.lineWidth = 2;
        ctx.strokeRect(gx + 1, gy + 1, cell - 2, cell - 2);
        this.drawPriceTag(`$${ELEVATOR_CAR_COST.toLocaleString()}`, gx + cell / 2, gy - 2);
      }
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
      hover.row < -MAX_DEPTH ||
      !!unitAt(plot, hover.col, hover.row);
    ctx.fillStyle = blocked ? "rgba(200,70,70,0.35)" : "rgba(120,220,120,0.35)";
    ctx.fillRect(x + 1, y + 1, wpx - 2, cell - 2);
    ctx.strokeStyle = blocked ? "#c84646" : "#78dc78";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, wpx - 2, cell - 2);
    if (!blocked) {
      let price = Math.round(def.cost * undergroundMultiplier(hover.row));
      // A brand-new elevator shaft is priced with its bundled first car.
      if (tool === "elevator" && autoCarNeeded(plot, hover.col, hover.row)) price += ELEVATOR_CAR_COST;
      this.drawPriceTag(`$${price.toLocaleString()}`, x + wpx / 2, y - 2);
    }
  }
}

/** Linear blend of two rgb triples. */
function mix(a: number[], b: number[], t: number): number[] {
  const tt = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * tt, a[1] + (b[1] - a[1]) * tt, a[2] + (b[2] - a[2]) * tt];
}
function rgb(c: number[]): string {
  return `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
}

/** Consecutive overlapping pairs of an array: [a,b,c] -> [[a,b],[b,c]]. */
function pairs(xs: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < xs.length - 1; i++) out.push([xs[i], xs[i + 1]]);
  return out;
}

/** Parse a #rrggbb hex into an [r,g,b] triple (falls back to mid-grey). */
function hexRgb(hex: string): number[] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
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
