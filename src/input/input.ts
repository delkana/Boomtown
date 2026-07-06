import type { GameConnection } from "../net/connection";
import type { Tool } from "../render/renderer";
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
    /** Called after a money-changing action, at the cursor, with the delta. */
    private moneyFx: (screenX: number, screenY: number, delta: number) => void,
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
    c.addEventListener("wheel", this.onWheel, { passive: false });
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
    c.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }

  /** Zoom by a factor, keeping `screenX` fixed (defaults to viewport center). */
  zoomBy(factor: number, screenX = this.camera.viewW / 2): void {
    this.camera.setZoomAt(this.camera.zoom * factor, screenX);
    this.clampCamera();
  }

  /** Called once per animation frame to apply held-key panning. */
  update(dtMs: number): void {
    const speed = 0.8 * dtMs; // px per ms
    if (this.keys.has("ArrowLeft") || this.keys.has("a")) this.camera.offsetX -= speed;
    if (this.keys.has("ArrowRight") || this.keys.has("d")) this.camera.offsetX += speed;
    this.clampCamera();
  }

  private clampCamera(): void {
    this.camera.clampToWorld();
  }

  private localPointer(e: PointerEvent | MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onPointerLeave = (): void => {
    this.hover = null;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const { x } = this.localPointer(e);
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    this.zoomBy(factor, x);
  };

  private onPointerDown = (e: PointerEvent): void => {
    const { x } = this.localPointer(e);
    this.dragging = true;
    this.movedWhileDragging = false;
    this.dragStartX = x;
    this.dragStartOffset = this.camera.offsetX;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic or inactive pointer */
    }
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

    if (this.selectedTool === "destroy") {
      this.tryDestroy(cell.plotIndex, cell.col, cell.row, x, y);
      return;
    }

    const playerId = this.conn.session.playerId;
    const tool = this.selectedTool;
    this.withMoneyFx(x, y, () => {
      if (tool === "claim") {
        this.conn.dispatch({ type: "CLAIM_PLOT", playerId, plotIndex: cell.plotIndex });
      } else if (tool === "girder") {
        this.conn.dispatch({ type: "PLACE_GIRDER", playerId, plotIndex: cell.plotIndex, col: cell.col, row: cell.row });
      } else if (tool) {
        this.conn.dispatch({
          type: "PLACE_UNIT",
          playerId,
          plotIndex: cell.plotIndex,
          kind: tool,
          col: cell.col,
          row: cell.row,
        });
      }
    });
  };

  /** Right-click also destroys the room / bare girder under the cursor. */
  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    const { x, y } = this.localPointer(e);
    const cell = this.camera.screenToCell(x, y);
    if (!cell) return;
    this.tryDestroy(cell.plotIndex, cell.col, cell.row, x, y);
  };

  /** Demolish the room at a cell, or a bare girder if no room is there. */
  private tryDestroy(plotIndex: number, col: number, row: number, screenX: number, screenY: number): void {
    const state = this.conn.getState();
    const plot = state.plots[plotIndex];
    const playerId = this.conn.session.playerId;
    if (!plot || plot.ownerId !== playerId) return;
    const unit = plot.units.find((u) => u.row === row && col >= u.col && col < u.col + u.width);
    this.withMoneyFx(screenX, screenY, () => {
      if (unit) {
        this.conn.dispatch({ type: "SELL_UNIT", playerId, plotIndex, unitId: unit.id });
      } else if ((plot.girders ?? []).some((g) => g.col === col && g.row === row)) {
        this.conn.dispatch({ type: "SELL_GIRDER", playerId, plotIndex, col, row });
      }
    });
  }

  /** Run an action and, if it changed the local player's money, flash the delta. */
  private withMoneyFx(screenX: number, screenY: number, action: () => void): void {
    const me = this.conn.session.playerId;
    const before = this.conn.getState().players[me]?.money ?? 0;
    action();
    const after = this.conn.getState().players[me]?.money ?? 0;
    if (after !== before) this.moneyFx(screenX, screenY, after - before);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.key);
    const map: Record<string, Tool> = {
      "1": "lobby",
      "2": "office",
      "3": "apartment",
      "4": "elevator",
      "5": "girder",
      g: "girder",
      G: "girder",
      c: "claim",
      C: "claim",
      x: "destroy",
      X: "destroy",
    };
    if (map[e.key]) this.setSelected(map[e.key]);
    if (e.key === "Escape") this.setSelected(null);
    if (e.key === "+" || e.key === "=") this.zoomBy(1.15);
    if (e.key === "-" || e.key === "_") this.zoomBy(1 / 1.15);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key);
  };

  setSelected(tool: Tool): void {
    this.selectedTool = tool;
    this.onSelectChange(tool);
  }
}
