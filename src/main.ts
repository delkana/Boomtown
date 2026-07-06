import { RenderLoop } from "./engine/loop";
import { Camera } from "./render/camera";
import { Renderer } from "./render/renderer";
import { InputController } from "./input/input";
import { Hud } from "./ui/hud";
import { Minimap } from "./ui/minimap";
import { CityLayout } from "./render/cityLayout";
import { LobbyScreen } from "./ui/lobby";
import { LocalServer, type GameServer } from "./net/localServer";
import { RemoteServer } from "./net/remoteServer";
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
const minimapEl = document.getElementById("minimap")!;
const zoomInBtn = document.getElementById("zoom-in")!;
const zoomOutBtn = document.getElementById("zoom-out")!;
const jumpBtn = document.getElementById("jump-btn")!;

/** Everything tied to one active in-game session; torn down on leave. */
interface Session {
  conn: GameConnection;
  camera: Camera;
  input: InputController;
  minimap: Minimap;
  loop: RenderLoop;
  unsub: () => void;
  buttons: Array<() => void>;
}
let active: Session | null = null;
let lobby: LobbyScreen;
let serverRef: GameServer;

leaveBtn.addEventListener("click", leaveGame);

/**
 * Pick a transport. With no config we run fully offline against LocalServer.
 * Point at a real server with `?server=ws://host:port` (or set
 * localStorage["boomtown.serverUrl"]) and the SAME app talks to server/wsServer
 * over WebSockets — that's the entire "go multiplayer" switch.
 */
async function init(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const url = params.get("server") || localStorage.getItem("boomtown.serverUrl") || "";
  let label = "Offline · local";

  if (url) {
    const remote = new RemoteServer(url);
    try {
      await remote.ready();
      serverRef = remote;
      label = `Online · ${url}`;
    } catch {
      serverRef = new LocalServer();
      label = "Offline · local (server unreachable)";
    }
  } else {
    serverRef = new LocalServer();
  }

  lobby = new LobbyScreen(lobbyEl, serverRef, enterGame, label);
  lobby.render();
}
void init();

function enterGame(conn: GameConnection): void {
  lobby.hide();
  gameRoot.classList.remove("hidden");

  const camera = new Camera();
  // Plot widths are fixed for the life of the game — build the layout once.
  camera.layout = new CityLayout(conn.getState());
  const renderer = new Renderer(canvas, camera);
  let hud: Hud;

  const input = new InputController(
    canvas,
    camera,
    conn,
    () => hud.update(),
    (sx, sy, delta) => renderer.addMoneyPopup(sx, sy, delta),
  );
  hud = new Hud(
    conn,
    () => input.selectedTool,
    (tool) => {
      input.setSelected(tool);
      hud.update();
    },
    (speed) => conn.dispatch({ type: "SET_SPEED", playerId: conn.session.playerId, speed }),
  );

  const totalPlots = Object.keys(conn.getState().plots).length;
  const minimap = new Minimap(minimapEl, conn, camera);

  // Size the canvas and center on the middle of the city.
  sizeCanvas(camera);
  jumpToMyPlots(conn, camera, Math.floor(totalPlots / 2));

  const unsub = conn.onSnapshot(() => hud.update());
  hud.update();

  // Nav controls.
  const onZoomIn = () => input.zoomBy(1.25);
  const onZoomOut = () => input.zoomBy(1 / 1.25);
  const onJump = () => jumpToMyPlots(conn, camera, Math.floor(totalPlots / 2));
  zoomInBtn.addEventListener("click", onZoomIn);
  zoomOutBtn.addEventListener("click", onZoomOut);
  jumpBtn.addEventListener("click", onJump);
  const buttons = [
    () => zoomInBtn.removeEventListener("click", onZoomIn),
    () => zoomOutBtn.removeEventListener("click", onZoomOut),
    () => jumpBtn.removeEventListener("click", onJump),
  ];

  const loop = new RenderLoop((dt) => {
    input.update(dt);
    renderer.render(conn.getState(), conn.session.playerId, input.hover, input.selectedTool);
    minimap.render();
  });
  loop.start();

  active = { conn, camera, input, minimap, loop, unsub, buttons };

  // Debug handle (also used for headless verification where rAF is suspended).
  (window as unknown as { boomtown: unknown }).boomtown = {
    server: serverRef,
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
  active.minimap.detach();
  active.unsub();
  active.buttons.forEach((off) => off());
  active.conn.leave();
  active = null;
  gameRoot.classList.add("hidden");
  lobby.show();
}

/** Center the camera on the player's first owned plot, or `fallback` if none. */
function jumpToMyPlots(conn: GameConnection, camera: Camera, fallback: number): void {
  const state = conn.getState();
  const me = conn.session.playerId;
  const mine = Object.values(state.plots)
    .filter((p) => p.ownerId === me)
    .map((p) => p.index)
    .sort((a, b) => a - b);
  camera.centerOnPlot(mine.length ? mine[0] : fallback);
  camera.clampToWorld();
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
