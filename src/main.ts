import { Game } from "./engine/game";
import { GameLoop } from "./engine/loop";
import { Camera } from "./render/camera";
import { Renderer } from "./render/renderer";
import { InputController } from "./input/input";
import { Hud } from "./ui/hud";

/**
 * Composition root. Wires the four layers together:
 *
 *   Game (STATE) ── dispatch(cmd) ◄── Input (produces commands)
 *      │  state                          │
 *      ▼                                 ▼ camera pan (view-only)
 *   Renderer (READ state -> canvas)   Hud (READ state -> DOM, emits selections)
 *
 * Only this file knows about all layers at once. In multiplayer, `Game` here
 * becomes a networked shell (send commands, receive snapshots) and NOTHING else
 * in this file has to change — that's the payoff of the clean separation.
 */

const canvas = document.getElementById("game") as HTMLCanvasElement;

const game = new Game();
const camera = new Camera();
const renderer = new Renderer(canvas, camera);

const input = new InputController(
  canvas,
  camera,
  () => game.state,
  game.dispatch,
  () => hud.update(),
);

const hud = new Hud(
  () => game.state,
  () => input.selectedKind,
  () => game.lastError,
  (kind) => {
    input.setSelected(kind);
    hud.update();
  },
);

// Keep the canvas matched to its display size (handles DPR for crisp art).
// Falls back to the window size if CSS layout hasn't settled yet (the module
// can run before the external stylesheet applies, leaving clientWidth at 0).
function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const first = camera.viewW === 0;
  camera.resize(w, h);
  // Center the camera on the player's plot the first time we get real dims.
  if (first && w > 0) {
    camera.offsetX = camera.plotLeftWorldX(0) - w / 2 + w * 0.2;
  }
}
window.addEventListener("resize", resize);
// ResizeObserver fires an initial callback once the canvas has a laid-out size,
// which reliably fixes the 0×0 case above regardless of stylesheet timing.
new ResizeObserver(resize).observe(canvas);
resize();

// Re-render the HUD whenever state changes (in addition to the render loop).
game.onChange(() => hud.update());

const loop = new GameLoop({
  onTick: () => game.tick(),
  onRender: (dt) => {
    input.update(dt);
    renderer.render(game.state, input.hover, input.selectedKind);
  },
});

hud.update();
loop.start();

// Expose for debugging in the console.
(window as unknown as { boomtown: unknown }).boomtown = {
  game,
  camera,
  input,
  // Force one render frame regardless of the rAF loop (used for headless checks
  // where the tab is hidden and requestAnimationFrame is suspended).
  renderOnce: () => renderer.render(game.state, input.hover, input.selectedKind),
  tickOnce: () => game.tick(),
};
