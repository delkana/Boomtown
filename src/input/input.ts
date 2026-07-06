import type { GameConnection } from "../net/connection";
import type { Tool } from "../render/renderer";
import type { Camera } from "../render/camera";
import type { HoverState } from "../render/renderer";

/** A room being inspected (hovered transiently, or clicked to pin). */
export interface InspectRef {
  plotIndex: number;
  unitId: string;
  pinned: boolean;
}

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
  /** Cosmetic facade style applied to newly placed girders (see facades.ts). */
  girderStyle = "glass";

  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragStartOffset = 0;
  private dragStartOffsetY = 0;
  private movedWhileDragging = false;
  /** Girder drag-paint: while the girder tool is held down, drag lays girders. */
  private painting = false;
  private lastPaintKey: string | null = null;
  private lastPaintPt: { x: number; y: number } | null = null;
  private paintStartMoney = 0;
  private keys = new Set<string>();
  /** A room clicked to "pin" its inspector panel open. */
  private pinned: { plotIndex: number; unitId: string } | null = null;
  private lastInspectKey: string | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: Camera,
    private conn: GameConnection,
    private onSelectChange: (tool: Tool) => void,
    /** Called after a money-changing action, at the cursor, with the delta. */
    private moneyFx: (screenX: number, screenY: number, delta: number) => void,
    /** Called when the inspected room (hover or pin) changes. */
    private onInspect: () => void,
  ) {
    this.attach();
  }

  /**
   * The room to show in the inspector: a pinned room takes priority; otherwise
   * the hovered room while in inspect (no-tool) mode. Null if nothing to show.
   */
  inspected(): InspectRef | null {
    const state = this.conn.getState();
    if (this.pinned) {
      const plot = state.plots[this.pinned.plotIndex];
      if (plot && plot.units.some((u) => u.id === this.pinned!.unitId)) {
        return { ...this.pinned, pinned: true };
      }
      this.pinned = null; // the pinned room was destroyed
    }
    if (this.selectedTool === null && this.hover) {
      const u = this.roomAt(this.hover.plotIndex, this.hover.col, this.hover.row);
      if (u) return { plotIndex: this.hover.plotIndex, unitId: u.id, pinned: false };
    }
    return null;
  }

  private roomAt(plotIndex: number, col: number, row: number) {
    const plot = this.conn.getState().plots[plotIndex];
    return plot?.units.find((u) => u.row === row && col >= u.col && col < u.col + u.width);
  }

  /** Fire onInspect only when the inspected room actually changes. */
  private notifyInspectIfChanged(): void {
    const cur = this.inspected();
    const key = cur ? `${cur.pinned ? "P" : "H"}:${cur.plotIndex}:${cur.unitId}` : null;
    if (key !== this.lastInspectKey) {
      this.lastInspectKey = key;
      this.onInspect();
    }
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
    if (this.keys.has("ArrowUp") || this.keys.has("w")) this.camera.offsetY += speed;
    if (this.keys.has("ArrowDown") || this.keys.has("s")) this.camera.offsetY -= speed;
    this.clampCamera();
  }

  private clampCamera(): void {
    this.camera.clampToWorld();
    this.camera.clampVertical();
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
    const { x, y } = this.localPointer(e);
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic or inactive pointer */
    }

    // Girder tool: click-and-drag paints girders instead of panning the view.
    if (this.selectedTool === "girder") {
      this.painting = true;
      this.lastPaintKey = null;
      this.lastPaintPt = { x, y };
      this.paintStartMoney = this.conn.getState().players[this.conn.session.playerId]?.money ?? 0;
      this.paintGirderAt(x, y);
      return;
    }

    this.dragging = true;
    this.movedWhileDragging = false;
    this.dragStartX = x;
    this.dragStartY = y;
    this.dragStartOffset = this.camera.offsetX;
    this.dragStartOffsetY = this.camera.offsetY;
  };

  private onPointerMove = (e: PointerEvent): void => {
    const { x, y } = this.localPointer(e);
    this.hover = this.camera.screenToCell(x, y);
    if (this.painting) {
      this.paintGirderLine(x, y);
      return;
    }
    if (this.dragging) {
      const dx = x - this.dragStartX;
      const dy = y - this.dragStartY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) this.movedWhileDragging = true;
      this.camera.offsetX = this.dragStartOffset - dx;
      this.camera.offsetY = this.dragStartOffsetY + dy; // drag down reveals higher content
      this.clampCamera();
    } else {
      this.notifyInspectIfChanged();
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const { x, y } = this.localPointer(e);
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer may already be released */
    }

    // Finish a girder paint stroke: flash the total spent once, at the cursor.
    if (this.painting) {
      this.painting = false;
      const after = this.conn.getState().players[this.conn.session.playerId]?.money ?? 0;
      if (after !== this.paintStartMoney) this.moneyFx(x, y, after - this.paintStartMoney);
      return;
    }

    const wasDrag = this.movedWhileDragging;
    this.dragging = false;
    if (wasDrag) return;

    // Inspect mode (no tool): click toggles the pinned room inspector.
    if (!this.selectedTool) {
      const cell = this.camera.screenToCell(x, y);
      const room = cell ? this.roomAt(cell.plotIndex, cell.col, cell.row) : undefined;
      if (room && cell) {
        this.pinned =
          this.pinned && this.pinned.unitId === room.id
            ? null // click the pinned room again → unpin
            : { plotIndex: cell.plotIndex, unitId: room.id };
      } else {
        this.pinned = null; // clicked empty space → dismiss
      }
      this.notifyInspectIfChanged();
      return;
    }

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
        this.conn.dispatch({ type: "PLACE_GIRDER", playerId, plotIndex: cell.plotIndex, col: cell.col, row: cell.row, style: this.girderStyle });
      } else if (tool === "elevatorCar") {
        this.conn.dispatch({ type: "PLACE_ELEVATOR_CAR", playerId, plotIndex: cell.plotIndex, col: cell.col, row: cell.row });
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

  /** Place a girder at a screen point (used by the drag-paint stroke). */
  private paintGirderAt(x: number, y: number): void {
    const cell = this.camera.screenToCell(x, y);
    if (!cell) return;
    const key = `${cell.plotIndex}:${cell.col}:${cell.row}`;
    if (key === this.lastPaintKey) return; // same cell as last time — skip
    this.lastPaintKey = key;
    const plot = this.conn.getState().plots[cell.plotIndex];
    if (!plot || plot.ownerId !== this.conn.session.playerId) return;
    this.conn.dispatch({
      type: "PLACE_GIRDER",
      playerId: this.conn.session.playerId,
      plotIndex: cell.plotIndex,
      col: cell.col,
      row: cell.row,
      style: this.girderStyle,
    });
  }

  /**
   * Paint girders along the line from the last painted point to (x,y), sampling
   * finely so a fast drag doesn't leave gaps between cells.
   */
  private paintGirderLine(x: number, y: number): void {
    const from = this.lastPaintPt ?? { x, y };
    const step = Math.max(4, this.camera.scale(48) / 2);
    const dist = Math.hypot(x - from.x, y - from.y);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let i = 1; i <= n; i++) {
      this.paintGirderAt(from.x + ((x - from.x) * i) / n, from.y + ((y - from.y) * i) / n);
    }
    this.lastPaintPt = { x, y };
  }

  /**
   * Suppress the browser context menu on the canvas. Right-click deliberately
   * does NOT delete anything — demolition is only via the Destroy tool, so it
   * can't be triggered by accident.
   */
  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  /**
   * Demolish, in priority order: an elevator car in this shaft (so you clear
   * cars before dismantling the shaft), then the room here, then a bare girder.
   */
  private tryDestroy(plotIndex: number, col: number, row: number, screenX: number, screenY: number): void {
    const state = this.conn.getState();
    const plot = state.plots[plotIndex];
    const playerId = this.conn.session.playerId;
    if (!plot || plot.ownerId !== playerId) return;
    const unit = plot.units.find((u) => u.row === row && col >= u.col && col < u.col + u.width);
    const carHere =
      unit?.kind === "elevator" && (plot.cars ?? []).some((c) => c.col === col);
    this.withMoneyFx(screenX, screenY, () => {
      if (carHere) {
        this.conn.dispatch({ type: "SELL_ELEVATOR_CAR", playerId, plotIndex, col, row });
      } else if (unit) {
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
      "3": "medical",
      "4": "apartment",
      "5": "store",
      "6": "restaurant",
      "7": "hotel",
      "8": "elevator",
      "9": "elevatorCar",
      g: "girder",
      G: "girder",
      c: "claim",
      C: "claim",
      x: "destroy",
      X: "destroy",
    };
    if (map[e.key]) this.setSelected(map[e.key]);
    if (e.key === "Escape") {
      if (this.pinned) {
        this.pinned = null;
        this.notifyInspectIfChanged();
      }
      this.setSelected(null);
    }
    if (e.key === "+" || e.key === "=") this.zoomBy(1.15);
    if (e.key === "-" || e.key === "_") this.zoomBy(1 / 1.15);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key);
  };

  setSelected(tool: Tool): void {
    this.selectedTool = tool;
    this.onSelectChange(tool);
    this.notifyInspectIfChanged();
  }
}
