import { PLAYER_COLORS, type ColorOption } from "../game/constants";
import type { Command } from "../game/commands";
import type { GameState } from "../game/types";
import type { GameConnection } from "./connection";
import type { GameServer, ConnectResult } from "./localServer";
import type {
  AuthResult,
  ClientMsg,
  CreateGameConfig,
  GameSummary,
  JoinRequest,
  PlayerSession,
  ServerMsg,
} from "./protocol";

/**
 * RemoteServer: the networked implementation of GameServer. It speaks the
 * WebSocket wire protocol (src/net/protocol.ts) to server/wsServer.ts, which
 * runs the exact same GameDirectory + AuthoritativeGame as LocalServer.
 *
 * This is the whole "go multiplayer" step: swap LocalServer for RemoteServer in
 * main.ts and nothing in the render/input/HUD/lobby layers changes.
 */
export class RemoteServer implements GameServer {
  private ws: WebSocket;
  private directory: GameSummary[] = [];
  private listeners = new Set<() => void>();
  private pending = new Map<number, (msg: Extract<ServerMsg, { t: "result" }>) => void>();
  private pendingAuth = new Map<number, (result: AuthResult) => void>();
  private reqSeq = 1;
  private active: RemoteConnection | null = null;
  private readyPromise: Promise<void>;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.readyPromise = new Promise((resolve, reject) => {
      const onOpen = () => resolve();
      const onError = () => reject(new Error(`Cannot connect to ${url}`));
      this.ws.addEventListener("open", onOpen, { once: true });
      this.ws.addEventListener("error", onError, { once: true });
    });
    this.ws.addEventListener("message", this.onMessage);
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  getPalette(): ColorOption[] {
    return PLAYER_COLORS;
  }

  listGames(): GameSummary[] {
    return this.directory;
  }

  onDirectoryChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  createGame(cfg: CreateGameConfig): Promise<ConnectResult> {
    return this.request((reqId) => ({ t: "create", reqId, cfg }));
  }

  joinGame(req: JoinRequest): Promise<ConnectResult> {
    return this.request((reqId) => ({ t: "join", reqId, req }));
  }

  reconnect(gameId: string, token: string): Promise<ConnectResult> {
    return this.request((reqId) => ({ t: "reconnect", reqId, gameId, token }));
  }

  // --- accounts ------------------------------------------------------------

  supportsAccounts(): boolean {
    return true;
  }

  register(username: string, password: string, displayName: string, color: string): Promise<AuthResult> {
    return this.authRequest((reqId) => ({ t: "register", reqId, username, password, displayName, color }));
  }

  login(username: string, password: string): Promise<AuthResult> {
    return this.authRequest((reqId) => ({ t: "login", reqId, username, password }));
  }

  resume(sessionToken: string): Promise<AuthResult> {
    return this.authRequest((reqId) => ({ t: "resume", reqId, sessionToken }));
  }

  logout(sessionToken: string): void {
    this.send({ t: "logout", sessionToken });
  }

  private authRequest(build: (reqId: number) => ClientMsg): Promise<AuthResult> {
    const reqId = this.reqSeq++;
    return new Promise<AuthResult>((resolve) => {
      this.pendingAuth.set(reqId, resolve);
      this.send(build(reqId));
    });
  }

  // --- internals -----------------------------------------------------------

  private request(build: (reqId: number) => ClientMsg): Promise<ConnectResult> {
    const reqId = this.reqSeq++;
    return new Promise<ConnectResult>((resolve) => {
      this.pending.set(reqId, (msg) => {
        if (!msg.ok) {
          resolve({ ok: false, error: msg.error });
          return;
        }
        const conn = new RemoteConnection(
          msg.session,
          msg.state,
          (cmd) => this.send({ t: "command", cmd }),
          () => {
            this.send({ t: "leave" });
            if (this.active === conn) this.active = null;
          },
        );
        this.active = conn;
        resolve({ ok: true, connection: conn });
      });
      this.send(build(reqId));
    });
  }

  private send(msg: ClientMsg): void {
    this.ws.send(JSON.stringify(msg));
  }

  private onMessage = (ev: MessageEvent): void => {
    const msg = JSON.parse(ev.data as string) as ServerMsg;
    switch (msg.t) {
      case "directory":
        this.directory = msg.games;
        for (const cb of this.listeners) cb();
        break;
      case "result": {
        const resolve = this.pending.get(msg.reqId);
        this.pending.delete(msg.reqId);
        resolve?.(msg);
        break;
      }
      case "auth": {
        const resolve = this.pendingAuth.get(msg.reqId);
        this.pendingAuth.delete(msg.reqId);
        resolve?.(msg.result);
        break;
      }
      case "snapshot":
        this.active?.applySnapshot(msg.state);
        break;
      case "cmdError":
        this.active?.setError(msg.error);
        break;
    }
  };
}

/** Client-side handle on a game hosted by a remote server. */
class RemoteConnection implements GameConnection {
  readonly session: PlayerSession;
  private state: GameState;
  private listeners = new Set<(s: GameState) => void>();
  private _lastError: string | null = null;

  constructor(
    session: PlayerSession,
    initialState: GameState,
    private sendCommand: (cmd: Command) => void,
    private onLeave: () => void,
  ) {
    this.session = session;
    this.state = initialState;
  }

  getState(): GameState {
    return this.state;
  }

  dispatch(cmd: Command): void {
    this._lastError = null;
    this.sendCommand(cmd);
  }

  onSnapshot(cb: (s: GameState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  lastError(): string | null {
    return this._lastError;
  }

  leave(): void {
    this.onLeave();
    this.listeners.clear();
  }

  /** Called by RemoteServer when a snapshot arrives for this game. */
  applySnapshot(state: GameState): void {
    this.state = state;
    for (const cb of this.listeners) cb(state);
  }

  /** Called by RemoteServer when a command is rejected. */
  setError(error: string): void {
    this._lastError = error;
    for (const cb of this.listeners) cb(this.state);
  }
}
