import type { Command, Dispatch } from "../game/commands";
import { applyCommand, type CommandResult } from "../game/reducer";
import { advanceTick } from "../game/tick";
import { createInitialState } from "../game/state";
import type { GameState } from "../game/types";

/**
 * Game: owns the authoritative state and the two ways it can change —
 * dispatching commands and advancing ticks.
 *
 * For single-player this class runs entirely on the client. For multiplayer,
 * an equivalent lives on the SERVER and this client-side object becomes a thin
 * shell that (a) forwards commands over the wire and (b) replaces its state
 * with server snapshots. The public surface (`state`, `dispatch`) is chosen so
 * the swap is transparent to the render/input layers. See README.
 */
export class Game {
  state: GameState;

  /** Listeners fired after any state change (render/HUD subscribe). */
  private listeners = new Set<() => void>();
  /** Last command error, surfaced to the HUD as a transient hint. */
  lastError: string | null = null;

  constructor(state?: GameState) {
    this.state = state ?? createInitialState();
  }

  /** THE command entry point. Swap this body for a socket send in multiplayer. */
  dispatch: Dispatch = (cmd: Command) => {
    const result: CommandResult = applyCommand(this.state, cmd);
    this.lastError = result.ok ? null : result.error ?? "Invalid action";
    this.emit();
  };

  /** Advance the simulation one economy step. Server-driven in multiplayer. */
  tick(): void {
    advanceTick(this.state);
    this.emit();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
