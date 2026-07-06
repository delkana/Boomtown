import { PLAYER_COLORS, type ColorOption } from "../game/constants";
import { GameDirectory, type DirResult } from "./gameDirectory";
import { LocalConnection, type GameConnection } from "./connection";
import type { GameSummary, CreateGameConfig, JoinRequest, PlayerSession } from "./protocol";

export type ConnectResult =
  | { ok: true; connection: GameConnection }
  | { ok: false; error: string };

/**
 * GameServer is the lobby boundary the UI depends on. It is intentionally
 * async (createGame/joinGame/reconnect return Promises, `ready()` resolves once
 * connected) so the SAME interface serves both the in-process LocalServer and
 * the networked RemoteServer (src/net/remoteServer.ts) with no UI changes.
 *
 * `listGames()` stays synchronous and returns a cached directory that updates
 * via `onDirectoryChange` — for the remote server that cache is fed by pushes.
 */
export interface GameServer {
  /** Resolves once the server is ready to take lobby requests. */
  ready(): Promise<void>;
  getPalette(): ColorOption[];
  listGames(): GameSummary[];
  onDirectoryChange(cb: () => void): () => void;
  createGame(cfg: CreateGameConfig): Promise<ConnectResult>;
  joinGame(req: JoinRequest): Promise<ConnectResult>;
  /** Re-enter a game via the reconnect token issued at create/join time. */
  reconnect(gameId: string, token: string): Promise<ConnectResult>;
}

// Bump this when the persisted state shape changes (e.g. variable plot widths),
// so incompatible old saves are discarded instead of breaking layout.
const LS_KEY = "boomtown.local.v5";

/**
 * In-process authoritative server. Wraps a GameDirectory and hands out
 * LocalConnections. Persists the whole directory to localStorage so offline
 * cities (and your buildings) survive a page refresh.
 */
export class LocalServer implements GameServer {
  private dir: GameDirectory;

  constructor() {
    this.dir = new GameDirectory();
    this.restore();
    this.dir.onChange(() => this.persist());
  }

  ready(): Promise<void> {
    return Promise.resolve();
  }

  getPalette(): ColorOption[] {
    return PLAYER_COLORS;
  }

  listGames(): GameSummary[] {
    return this.dir.summaries();
  }

  onDirectoryChange(cb: () => void): () => void {
    return this.dir.onChange(cb);
  }

  async createGame(cfg: CreateGameConfig): Promise<ConnectResult> {
    return this.wrap(this.dir.create(cfg));
  }

  async joinGame(req: JoinRequest): Promise<ConnectResult> {
    return this.wrap(this.dir.join(req));
  }

  async reconnect(gameId: string, token: string): Promise<ConnectResult> {
    return this.wrap(this.dir.reconnect(gameId, token));
  }

  // --- internals -----------------------------------------------------------

  private wrap(r: DirResult): ConnectResult {
    if (!r.ok) return { ok: false, error: r.error };
    const player = r.game.state.players[r.playerId];
    const session: PlayerSession = {
      gameId: r.game.state.id,
      playerId: r.playerId,
      playerName: player.name,
      colorHex: player.color,
      token: r.token,
    };
    return { ok: true, connection: new LocalConnection(r.game, session) };
  }

  private persist(): void {
    try {
      localStorage.setItem(LS_KEY, this.dir.serialize());
    } catch {
      /* storage unavailable or full — offline persistence is best-effort */
    }
  }

  private restore(): void {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) this.dir.load(saved);
    } catch {
      /* corrupt/absent — fall back to the freshly seeded demo cities */
    }
  }
}
