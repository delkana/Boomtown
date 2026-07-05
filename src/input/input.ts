import type { GameConnection } from "../net/connection";
import type { Tool } from "../render/renderer";
import { MAX_PLOTS } from "../game/constants";
import type { Camera } from "../render/camera";
import type { HoverState } from "../render/renderer";

/**
 * Input layer: translates raw pointer/keyboard events into either
 *   (a) camera movement (pure view state, never leaves the client), or
 *   (b) game Commands dispatched through the connection (the network boundary).
 *
 * It reads state only via the connection (acting player id, plot ownership). It
 * never mutates state — claim/build/sell all happen via `connection.dispatch`.
 */
export class InputController {
  hover: HoverState | null = null;
  /** Currently selected tool: a build unit, "claim", or null (pan/inspect). */
  selectedTool: Tool = "claim";

  private dragging = false;
  private dragStartX = 0;
  private dragStartOffset = 0;
  private movedWhileDragging = false;
  private keys = new Set<string>();

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: Camera,
    private conn: GameConnection,
    private onSelectChange: (tool: Tool) => void,
  ) {
    this.attach();
  }

  private attach(): void {
    const c = this.canvas;
    c.addEventListener("pointerdown", this.onPointerDown);
    c.addEventListener("pointermove", this.onPointerMove);
    c.addEventListener("pointerup", this.onPointerUp);
    c.addEventListener("pointerleave", this.onPointerLeave);
    c.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  /** Remove all listeners — called when leaving a game back to the lobby. */
  detach(): void {
    const c = this.canvas;
    c.removeEventListener("pointerdown", this.onPointerDown);
    c.removeEventListener("pointermove", this.onPointerMove);
    c.removeEventListener("pointerup", this.onPointerUp);
    c.removeEventListener("pointerleave", this.onPointerLeave);
    c.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }

  /** Called once per animation frame to apply held-key panning. */
  update(dtMs: number): void {
    const speed = 0.8 * dtMs; // px per ms
    if (this.keys.has("ArrowLeft") || this.keys.has("a")) this.camera.offsetX -= speed;
    if (this.keys.has("ArrowRight") || this.keys.has("d")) this.camera.offsetX += speed;
    this.clampCamera();
  }

  private clampCamera(): void {
    const plotCount = this.conn.getState().config.plotCount || MAX_PLOTS;
    this.camera.clampToWorld(0, plotCount - 1);
  }

  private localPointer(e: PointerEvent | MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onPointerLeave = (): void => {
    this.hover = null;
  };

  private onPointerDown = (e: PointerEvent): void => {
    const { x } = this.localPointer(e);
    this.dragging = true;
    this.movedWhileDragging = false;
    this.dragStartX = x;
    this.dragStartOffset = this.camera.offsetX;
    this.canvas.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    const { x, y } = this.localPointer(e);
    this.hover = this.camera.screenToCell(x, y);
    if (this.dragging) {
      const dx = x - this.dragStartX;
      if (Math.abs(dx) > 4) this.movedWhileDragging = true;
      this.camera.offsetX = this.dragStartOffset - dx;
      this.clampCamera();
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const { x, y } = this.localPointer(e);
    const wasDrag = this.movedWhileDragging;
    this.dragging = false;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer may already be released */
    }
    if (wasDrag || !this.selectedTool) return;

    const cell = this.camera.screenToCell(x, y);
    if (!cell) return;
    const state = this.conn.getState();
    if (!state.plots[cell.plotIndex]) return; // clicked the gap between plots

    const playerId = this.conn.session.playerId;
    if (this.selectedTool === "claim") {
      this.conn.dispatch({ type: "CLAIM_PLOT", playerId, plotIndex: cell.plotIndex });
    } else {
      this.conn.dispatch({
        type: "PLACE_UNIT",
        playerId,
        plotIndex: cell.plotIndex,
        kind: this.selectedTool,
        col: cell.col,
        row: cell.row,
      });
    }
  };

  /** Right-click sells the unit under the cursor (on your own plots). */
  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    const { x, y } = this.localPointer(e);
    const cell = this.camera.screenToCell(x, y);
    if (!cell) return;
    const state = this.conn.getState();
    const plot = state.plots[cell.plotIndex];
    const playerId = this.conn.session.playerId;
    if (!plot || plot.ownerId !== playerId) return;
    const unit = plot.units.find(
      (u) => u.row === cell.row && cell.col >= u.col && cell.col < u.col + u.width,
    );
    if (!unit) return;
    this.conn.dispatch({
      type: "SELL_UNIT",
      playerId,
      plotIndex: cell.plotIndex,
      unitId: unit.id,
    });
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.key);
    const map: Record<string, Tool> = {
      "1": "lobby",
      "2": "office",
      "3": "apartment",
      "4": "elevator",
      c: "claim",
      C: "claim",
    };
    if (map[e.key]) this.setSelected(map[e.key]);
    if (e.key === "Escape") this.setSelected(null);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key);
  };

  setSelected(tool: Tool): void {
    this.selectedTool = tool;
    this.onSelectChange(tool);
  }
}
