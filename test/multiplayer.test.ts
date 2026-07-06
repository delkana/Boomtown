import { describe, it, expect, afterAll } from "vitest";
import { WebSocket } from "ws";
import { startServer, type ServerHandle } from "../server/wsServer";
import type { ClientMsg, ServerMsg } from "../src/net/protocol";
import type { GameState } from "../src/game/types";
import type { Command } from "../src/game/commands";

/**
 * End-to-end multiplayer over REAL WebSockets: boots the authoritative server
 * and connects two independent `ws` clients (as two separate players), then
 * asserts that one player's actions propagate to the other via snapshots, and
 * that the server derives identity from the connection (not the payload).
 */

let handle: ServerHandle;

afterAll(async () => {
  await handle?.close();
});

/** A tiny promise-based client over the wire protocol. */
class TestClient {
  private ws: WebSocket;
  private reqSeq = 1;
  private pending = new Map<number, (m: Extract<ServerMsg, { t: "result" }>) => void>();
  latest: GameState | null = null;
  private snapshotWaiters: Array<(s: GameState) => void> = [];

  private constructor(url: string) {
    this.ws = new WebSocket(url);
  }

  static connect(url: string): Promise<TestClient> {
    const c = new TestClient(url);
    return new Promise((resolve, reject) => {
      c.ws.on("open", () => resolve(c));
      c.ws.on("error", reject);
      c.ws.on("message", (data: Buffer) => c.onMessage(JSON.parse(data.toString()) as ServerMsg));
    });
  }

  private onMessage(msg: ServerMsg): void {
    if (msg.t === "result") {
      this.pending.get(msg.reqId)?.(msg);
      this.pending.delete(msg.reqId);
    } else if (msg.t === "snapshot") {
      this.latest = msg.state;
      const waiters = this.snapshotWaiters;
      this.snapshotWaiters = [];
      for (const w of waiters) w(msg.state);
    }
  }

  private send(msg: ClientMsg): void {
    this.ws.send(JSON.stringify(msg));
  }

  request(build: (reqId: number) => ClientMsg): Promise<Extract<ServerMsg, { t: "result" }>> {
    const reqId = this.reqSeq++;
    return new Promise((resolve) => {
      this.pending.set(reqId, resolve);
      this.send(build(reqId));
    });
  }

  command(cmd: Command): void {
    this.send({ t: "command", cmd });
  }

  /** Resolve on the next snapshot whose state satisfies `pred` (with a timeout). */
  waitForSnapshot(pred: (s: GameState) => boolean, ms = 2000): Promise<GameState> {
    if (this.latest && pred(this.latest)) return Promise.resolve(this.latest);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("snapshot timeout")), ms);
      const check = (s: GameState) => {
        if (pred(s)) {
          clearTimeout(timer);
          resolve(s);
        } else {
          this.snapshotWaiters.push(check);
        }
      };
      this.snapshotWaiters.push(check);
    });
  }

  close(): void {
    this.ws.close();
  }
}

describe("networked multiplayer", () => {
  it("syncs one player's build to another player over the wire", async () => {
    handle = await startServer({ port: 0, seed: false });
    const url = `ws://127.0.0.1:${handle.port}`;

    // Player A creates a game.
    const a = await TestClient.connect(url);
    const created = await a.request((reqId) => ({
      t: "create",
      reqId,
      cfg: {
        cityName: "Wire City",
        archetype: "pacifica",
        backgroundNear: "skyline",
        backgroundFar: "mountains",
        latitude: 40,
        plotCount: 6,
        maxPlayers: 4,
        password: null,
        playerName: "Ada",
        playerColor: "crimson",
      },
    }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const gameId = created.session.gameId;
    const aId = created.session.playerId;

    // Player B joins the same game.
    const b = await TestClient.connect(url);
    const joined = await b.request((reqId) => ({
      t: "join",
      reqId,
      req: { gameId, playerName: "Bo", playerColor: "azure", password: null },
    }));
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    const bId = joined.session.playerId;
    expect(bId).not.toBe(aId);

    // A claims plot 0 and builds a lobby; B should SEE both via snapshots.
    a.command({ type: "CLAIM_PLOT", playerId: aId, plotIndex: 0 });
    await b.waitForSnapshot((s) => s.plots[0].ownerId === aId);

    // Frame the ground cells, then build the lobby over them.
    a.command({ type: "PLACE_GIRDER", playerId: aId, plotIndex: 0, col: 0, row: 0 });
    a.command({ type: "PLACE_GIRDER", playerId: aId, plotIndex: 0, col: 1, row: 0 });
    await b.waitForSnapshot((s) => s.plots[0].girders.length >= 2);

    a.command({ type: "PLACE_UNIT", playerId: aId, plotIndex: 0, kind: "lobby", col: 0, row: 0 });
    const seen = await b.waitForSnapshot((s) => s.plots[0].units.some((u) => u.kind === "lobby"));
    expect(seen.plots[0].units[0].kind).toBe("lobby");
    expect(seen.players[aId].name).toBe("Ada");
    expect(seen.players[bId].name).toBe("Bo");

    a.close();
    b.close();
  });

  it("ignores a spoofed playerId — identity comes from the connection", async () => {
    const url = `ws://127.0.0.1:${handle.port}`;
    // Fresh game with two players.
    const a = await TestClient.connect(url);
    const created = await a.request((reqId) => ({
      t: "create",
      reqId,
      cfg: {
        cityName: "Trust City", archetype: "japan", backgroundNear: "skyline", backgroundFar: "mountains",
        latitude: 40, plotCount: 5, maxPlayers: 4,
        password: null, playerName: "Owner", playerColor: "crimson",
      },
    }));
    if (!created.ok) return;
    const gameId = created.session.gameId;
    const ownerId = created.session.playerId;

    const b = await TestClient.connect(url);
    const joined = await b.request((reqId) => ({
      t: "join", reqId,
      req: { gameId, playerName: "Intruder", playerColor: "azure", password: null },
    }));
    if (!joined.ok) return;

    // Owner claims plot 0.
    a.command({ type: "CLAIM_PLOT", playerId: ownerId, plotIndex: 0 });
    await b.waitForSnapshot((s) => s.plots[0].ownerId === ownerId);

    // Intruder tries to build on the owner's plot by SPOOFING the owner's id.
    b.command({ type: "PLACE_UNIT", playerId: ownerId, plotIndex: 0, kind: "lobby", col: 0, row: 0 });

    // Give the server a beat; the build must NOT succeed (server used B's real id).
    await new Promise((r) => setTimeout(r, 150));
    expect(a.latest?.plots[0].units.length ?? 0).toBe(0);

    a.close();
    b.close();
  });
});
