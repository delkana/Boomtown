import { CELL_SIZE, MAX_ROWS } from "../game/constants";
import type { Camera } from "../render/camera";
import type { GameConnection } from "../net/connection";

/**
 * Minimap: a compact overview of the whole city strip. Shows every plot as a
 * bar (height ∝ tower height, colored by owner) plus a viewport window, and
 * lets you click/drag to jump the camera. Read-only on state; it only moves the
 * camera (pure view), never dispatches commands.
 */
export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(
    private el: HTMLElement,
    private conn: GameConnection,
    private camera: Camera,
  ) {
    this.canvas = document.createElement("canvas");
    this.el.appendChild(this.canvas);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("minimap 2D context unavailable");
    this.ctx = ctx;
    this.canvas.addEventListener("pointerdown", this.onPointer);
    this.canvas.addEventListener("pointermove", this.onDrag);
  }

  detach(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointer);
    this.canvas.removeEventListener("pointermove", this.onDrag);
    this.el.removeChild(this.canvas);
  }

  private contentWidth(): number {
    return this.camera.layout?.totalWorldWidth || this.cssW();
  }
  private cssW(): number {
    return this.el.clientWidth;
  }
  private mapScale(): number {
    return this.cssW() / this.contentWidth();
  }

  private onPointer = (e: PointerEvent): void => {
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic or already-released pointer */
    }
    this.jumpTo(e);
  };
  private onDrag = (e: PointerEvent): void => {
    if (e.buttons & 1) this.jumpTo(e);
  };
  private jumpTo(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const worldX = (e.clientX - rect.left) / this.mapScale();
    this.camera.centerOnWorldX(worldX);
    this.camera.clampToWorld();
  }

  render(): void {
    const w = this.cssW();
    const h = this.el.clientHeight;
    if (w <= 0 || h <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const state = this.conn.getState();
    const me = this.conn.session.playerId;
    const scale = this.mapScale();
    const groundY = h - 4;
    const usableH = h - 8;

    // Ground line.
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(0, groundY, w, 1);

    for (const key of Object.keys(state.plots)) {
      const plot = state.plots[Number(key)];
      const x = this.camera.plotLeftWorldX(plot.index) * scale;
      const plotW = plot.cols * CELL_SIZE * scale;
      const owner = plot.ownerId ? state.players[plot.ownerId] : undefined;
      const maxRow = plot.units.reduce((m, u) => Math.max(m, u.row + 1), 0);

      if (!plot.ownerId) {
        // Unclaimed: faint stub.
        ctx.fillStyle = "rgba(150,210,150,0.18)";
        ctx.fillRect(x, groundY - 3, Math.max(1, plotW), 3);
        continue;
      }
      const barH = Math.max(3, (maxRow / MAX_ROWS) * usableH);
      ctx.fillStyle = owner?.color ?? "#9fb0c0";
      ctx.fillRect(x, groundY - barH, Math.max(1, plotW), barH);
      if (plot.ownerId === me) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, groundY - barH + 0.5, Math.max(1, plotW) - 1, barH - 1);
      }
    }

    // Viewport window.
    const viewWorld = this.camera.viewW / this.camera.zoom;
    const vx = this.camera.offsetX * scale;
    const vw = viewWorld * scale;
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(Math.max(0.5, vx), 1, Math.min(vw, w - 1), h - 2);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(Math.max(0, vx), 0, vw, h);
  }
}
