import { RenderLoop } from "./engine/loop";
import { Camera } from "./render/camera";
import { Renderer } from "./render/renderer";
import { InputController } from "./input/input";
import { Hud } from "./ui/hud";
import { LobbyScreen } from "./ui/lobby";
import { LocalServer } from "./net/localServer";
import type { GameConnection } from "./net/connection";

/**
 * Composition root. Two phases:
 *
 *   1. LOBBY   — LobbyScreen talks to the GameServer (create/join a game) and
 *                hands back a GameConnection.
 *   2. IN-GAME — Camera + Renderer + Input + HUD are wired to that connection.
 *
 * The server owns the state and the tick clock; the client only sends commands
 * and renders snapshots. Swapping LocalServer for a networked client is the
 * ONLY change needed to go multiplayer — this file's wiring stays identical.
 */

const canvas = document.getElementById("game") as HTMLCanvasElement;
const lobbyEl = document.getElementById("lobby")!;
const gameRoot = document.getElementById("game-root")!;
const leaveBtn = document.getElementById("leave-btn")!;

const server = new LocalServer();

/** Everything tied to one active in-game session; torn down on leave. */
interface Session {
  conn: GameConnection;
  camera: Camera;
  input: InputController;
  loop: RenderLoop;
  unsub: () => void;
}
let active: Session | null = null;

const lobby = new LobbyScreen(lobbyEl, server, enterGame);
lobby.render();

leaveBtn.addEventListener("click", leaveGame);

function enterGame(conn: GameConnection): void {
  lobby.hide();
  gameRoot.classList.remove("hidden");

  const camera = new Camera();
  const renderer = new Renderer(canvas, camera);
  let hud: Hud;

  const input = new InputController(canvas, camera, conn, () => hud.update());
  hud = new Hud(conn, () => input.selectedTool, (tool) => {
    input.setSelected(tool);
    hud.update();
  });

  // Size the canvas and center on the middle of the city.
  sizeCanvas(camera);
  const mid = Math.floor(conn.getState().config.plotCount / 2);
  camera.offsetX = camera.plotLeftWorldX(mid) - camera.viewW / 2;

  const unsub = conn.onSnapshot(() => hud.update());
  hud.update();

  const loop = new RenderLoop((dt) => {
    input.update(dt);
    renderer.render(conn.getState(), conn.session.playerId, input.hover, input.selectedTool);
  });
  loop.start();

  active = { conn, camera, input, loop, unsub };

  // Debug handle (also used for headless verification where rAF is suspended).
  (window as unknown as { boomtown: unknown }).boomtown = {
    server,
    conn,
    camera,
    input,
    renderOnce: () =>
      renderer.render(conn.getState(), conn.session.playerId, input.hover, input.selectedTool),
  };
}

function leaveGame(): void {
  if (!active) return;
  active.loop.stop();
  active.input.detach();
  active.unsub();
  active.conn.leave();
  active = null;
  gameRoot.classList.add("hidden");
  lobby.show();
}

function sizeCanvas(camera: Camera): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  camera.resize(w, h);
}

// Keep the active game's canvas matched to its display size.
function onResize(): void {
  if (!active) return;
  sizeCanvas(active.camera);
}
window.addEventListener("resize", onResize);
new ResizeObserver(onResize).observe(canvas);
