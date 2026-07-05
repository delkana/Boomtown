import { deserialize, serialize } from "../game/state";
import type { Command } from "../game/commands";
import type { CommandResult } from "../game/reducer";
import type { GameState } from "../game/types";
import type { AuthoritativeGame } from "./authoritativeGame";
import type { PlayerSession } from "./protocol";

/**
 * GameConnection is the CLIENT's handle on a game. The render/input/HUD layers
 * only ever talk to this interface — they read state via `getState()`, send
 * intents via `dispatch()`, and react to server updates via `onSnapshot()`.
 *
 * Today the only implementation is LocalConnection (talks to an in-process
 * AuthoritativeGame). A networked build adds a `SocketConnection` with the same
 * interface, and the rest of the app is none the wiser.
 */
export interface GameConnection {
  readonly session: PlayerSession;
  /** Latest known world state (the most recent snapshot). */
  getState(): GameState;
  /** Send a player intent to the server. */
  dispatch(cmd: Command): void;
  /** Subscribe to state updates. Returns an unsubscribe fn. */
  onSnapshot(cb: (state: GameState) => void): () => void;
  /** Last command rejection reason, or null. */
  lastError(): string | null;
  /** Detach from the game (stop receiving snapshots). */
  leave(): void;
}

export class LocalConnection implements GameConnection {
  readonly session: PlayerSession;

  private state: GameState;
  private listeners = new Set<(state: GameState) => void>();
  private unsubscribe: () => void;
  private _lastError: string | null = null;

  constructor(
    private readonly game: AuthoritativeGame,
    session: PlayerSession,
  ) {
    this.session = session;
    // Seed from a serialized snapshot — the exact path a network client takes,
    // so we dogfood serialize/deserialize instead of sharing object refs.
    this.state = deserialize(serialize(game.state));
    this.unsubscribe = game.subscribe((snapshot) => {
      this.state = deserialize(snapshot);
      this.emit();
    });
  }

  getState(): GameState {
    return this.state;
  }

  dispatch(cmd: Command): void {
    const result: CommandResult = this.game.command(cmd);
    this._lastError = result.ok ? null : result.error ?? "Invalid action";
    // A successful command already broadcast a snapshot (updating our state via
    // the subscription). A rejected one did NOT change state, so emit here so
    // the UI still picks up the error text.
    this.emit();
  }

  onSnapshot(cb: (state: GameState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  lastError(): string | null {
    return this._lastError;
  }

  leave(): void {
    this.unsubscribe();
    this.listeners.clear();
  }

  private emit(): void {
    for (const cb of this.listeners) cb(this.state);
  }
}
