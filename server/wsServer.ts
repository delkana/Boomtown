import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { GameDirectory } from "../src/net/gameDirectory";
import type { AuthoritativeGame } from "../src/net/authoritativeGame";
import type { ClientMsg, PlayerSession, ServerMsg } from "../src/net/protocol";
import type { DirResult } from "../src/net/gameDirectory";

/**
 * The authoritative WebSocket server. It runs the identical GameDirectory +
 * AuthoritativeGame code the client's LocalServer uses, so offline and online
 * play behave the same. Persistence and process wiring live in server/index.ts;
 * this module is transport + routing only, and is imported by the integration
 * test so it can drive real sockets.
 *
 * Security note: the acting player is derived from the CONNECTION (the id the
 * server assigned at create/join), never from the client-supplied command
 * payload. A client cannot act as another player by spoofing `playerId`.
 */
export interface ServerHandle {
  port: number;
  directory: GameDirectory;
  close: () => Promise<void>;
}

export function startServer(
  opts: { port?: number; seed?: boolean; staticDir?: string } = {},
): Promise<ServerHandle> {
  const dir = new GameDirectory({ seed: opts.seed ?? true });
  // One HTTP server both serves the built web app (in production) and hosts the
  // WebSocket endpoint, so a single Railway service/port does everything.
  const httpServer = http.createServer((req, res) => {
    if (opts.staticDir) serveStatic(opts.staticDir, req, res);
    else {
      res.writeHead(426, { "content-type": "text/plain" });
      res.end("Boomtown WebSocket server");
    }
  });
  const wss = new WebSocketServer({ server: httpServer });

  const send = (ws: WebSocket, msg: ServerMsg): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const broadcastDirectory = (): void => {
    const msg: ServerMsg = { t: "directory", games: dir.summaries() };
    for (const client of wss.clients) send(client, msg);
  };
  dir.onChange(broadcastDirectory);

  wss.on("connection", (ws: WebSocket) => {
    let game: AuthoritativeGame | null = null;
    let playerId: string | null = null;
    let unsub: (() => void) | null = null;

    const detach = (): void => {
      unsub?.();
      unsub = null;
      game = null;
      playerId = null;
    };
    const attach = (g: AuthoritativeGame, pid: string): void => {
      detach();
      game = g;
      playerId = pid;
      unsub = g.subscribe((snap) => send(ws, { t: "snapshot", state: JSON.parse(snap) }));
    };
    const enter = (r: DirResult, reqId: number): void => {
      if (!r.ok) {
        send(ws, { t: "result", reqId, ok: false, error: r.error });
        return;
      }
      attach(r.game, r.playerId);
      const p = r.game.state.players[r.playerId];
      const session: PlayerSession = {
        gameId: r.game.state.id,
        playerId: r.playerId,
        playerName: p.name,
        colorHex: p.color,
        token: r.token,
      };
      send(ws, { t: "result", reqId, ok: true, session, state: r.game.state });
    };

    // Send the current directory immediately so the lobby can render.
    send(ws, { t: "directory", games: dir.summaries() });

    ws.on("message", (data: Buffer) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(data.toString()) as ClientMsg;
      } catch {
        return;
      }
      switch (msg.t) {
        case "create":
          enter(dir.create(msg.cfg), msg.reqId);
          break;
        case "join":
          enter(dir.join(msg.req), msg.reqId);
          break;
        case "reconnect":
          enter(dir.reconnect(msg.gameId, msg.token), msg.reqId);
          break;
        case "command":
          if (game && playerId) {
            // Identity from the connection, not from the client payload.
            const result = game.command({ ...msg.cmd, playerId });
            if (!result.ok) send(ws, { t: "cmdError", error: result.error ?? "Invalid action" });
          }
          break;
        case "leave":
          detach();
          break;
      }
    });

    ws.on("close", detach);
  });

  return new Promise<ServerHandle>((resolve) => {
    httpServer.listen(opts.port ?? 8787, "0.0.0.0", () => {
      const addr = httpServer.address();
      const port = typeof addr === "object" && addr ? addr.port : (opts.port ?? 8787);
      resolve({
        port,
        directory: dir,
        close: () =>
          new Promise<void>((res) => {
            for (const c of wss.clients) c.terminate();
            wss.close(() => httpServer.close(() => res()));
          }),
      });
    });
  });
}

/** Content types for the handful of file kinds the built app ships. */
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/**
 * Minimal static file server for the built `dist/`. Guards against path
 * traversal and falls back to index.html for unknown routes (single-page app).
 */
function serveStatic(root: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const rel = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  let file = path.join(root, rel);
  if (!file.startsWith(root)) file = path.join(root, "index.html"); // traversal → home
  if (urlPath === "/" || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(root, "index.html");
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(data);
  });
}
