import type { Dispatch } from "../game/commands";
import type { GameState, UnitKind } from "../game/types";
import { NEIGHBOR_PLOTS_EACH_SIDE } from "../game/constants";
import type { Camera } from "../render/camera";
import type { HoverState } from "../render/renderer";

/**
 * Input layer: translates raw pointer/keyboard events into either
 *   (a) camera movement (pure view state, never leaves the client), or
 *   (b) game Commands dispatched through the boundary.
 *
 * It reads GameState only to know the acting player id and plot ownership. It
 * never mutates state — placement happens exclusively via `dispatch`.
 */
export class InputController {
  hover: HoverState | null = null;
  /** Currently selected build tool, or null (pan/inspect mode). */
  selectedKind: UnitKind | null = "lobby";

  private dragging = false;
  private dragStartX = 0;
  private dragStartOffset = 0;
  private movedWhileDragging = false;
  private keys = new Set<string>();

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: Camera,
    private getState: () => GameState,
    private dispatch: Dispatch,
    private onSelectChange: (kind: UnitKind | null) => void,
  ) {
    this.attach();
  }

  private attach(): void {
    const c = this.canvas;
    c.addEventListener("pointerdown", this.onPointerDown);
    c.addEventListener("pointermove", this.onPointerMove);
    c.addEventListener("pointerup", this.onPointerUp);
    c.addEventListener("pointerleave", () => (this.hover = null));
    c.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  /** Called once per animation frame to apply held-key panning. */
  update(dtMs: number): void {
    const speed = 0.8 * dtMs; // px per ms
    if (this.keys.has("ArrowLeft") || this.keys.has("a")) this.camera.offsetX -= speed;
    if (this.keys.has("ArrowRight") || this.keys.has("d")) this.camera.offsetX += speed;
    this.clampCamera();
  }

  private clampCamera(): void {
    this.camera.clampToWorld(-NEIGHBOR_PLOTS_EACH_SIDE, NEIGHBOR_PLOTS_EACH_SIDE);
  }

  private localPointer(e: PointerEvent | MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

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
    // Update hover cell for the build ghost.
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

    // A click (not a drag) with a build tool selected = place a unit.
    if (!wasDrag && this.selectedKind) {
      const cell = this.camera.screenToCell(x, y);
      if (!cell) return;
      const state = this.getState();
      this.dispatch({
        type: "PLACE_UNIT",
        playerId: state.localPlayerId,
        plotIndex: cell.plotIndex,
        kind: this.selectedKind,
        col: cell.col,
        row: cell.row,
      });
    }
  };

  /** Right-click sells the unit under the cursor. */
  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    const { x, y } = this.localPointer(e);
    const cell = this.camera.screenToCell(x, y);
    if (!cell) return;
    const state = this.getState();
    const plot = state.plots[cell.plotIndex];
    if (!plot || plot.ownerId !== state.localPlayerId) return;
    const unit = plot.units.find(
      (u) => u.row === cell.row && cell.col >= u.col && cell.col < u.col + u.width,
    );
    if (!unit) return;
    this.dispatch({
      type: "SELL_UNIT",
      playerId: state.localPlayerId,
      plotIndex: cell.plotIndex,
      unitId: unit.id,
    });
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.key);
    // Tool hotkeys 1-4.
    const map: Record<string, UnitKind> = {
      "1": "lobby",
      "2": "office",
      "3": "apartment",
      "4": "elevator",
    };
    if (map[e.key]) this.setSelected(map[e.key]);
    if (e.key === "Escape") this.setSelected(null);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key);
  };

  setSelected(kind: UnitKind | null): void {
    this.selectedKind = kind;
    this.onSelectChange(kind);
  }
}
