import { applyCommand, type CommandResult } from "../game/reducer";
import { advanceTick } from "../game/tick";
import { createGameState, serialize } from "../game/state";
import { STARTING_MONEY, TICK_SECONDS, UNIT_DEFS } from "../game/constants";
import { elevatorRuns } from "../game/elevator";
import type { Command } from "../game/commands";
import type { GameConfig, GameState, Player, UnitKind } from "../game/types";
import type { GameSummary } from "./protocol";

/**
 * AuthoritativeGame is the SERVER-SIDE owner of one game's state. It is the only
 * thing that mutates `GameState`, via two paths: player commands and the
 * periodic economy tick. It broadcasts serialized snapshots to subscribers.
 *
 * This class runs inside the local fake server today; the exact same class
 * would run on a real server. It has no DOM dependency — only `setInterval`,
 * which exists in both browser and Node.
 */
export class AuthoritativeGame {
  readonly state: GameState;
  readonly password: string | null;

  private subscribers = new Set<(snapshot: string) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Speed the current tick interval was set for (to detect speed changes). */
  private tickSpeed = 1;

  /** Build from an existing state (fresh via `create`, or restored from disk). */
  constructor(state: GameState, password: string | null) {
    this.state = state;
    this.password = password;
  }

  /** Create a brand-new game with a seeded empty world. */
  static create(id: string, config: GameConfig, password: string | null): AuthoritativeGame {
    return new AuthoritativeGame(createGameState(id, config), password);
  }

  /** Register a new player and return them. */
  addPlayer(name: string, colorHex: string): Player {
    const id = `p${this.state.nextPlayerSeq++}`;
    const player: Player = { id, name, color: colorHex, money: STARTING_MONEY };
    this.state.players[id] = player;
    this.broadcast();
    return player;
  }

  /** Apply a player command; broadcast a fresh snapshot on success. */
  command(cmd: Command): CommandResult {
    const result = applyCommand(this.state, cmd);
    if (result.ok) {
      this.broadcast();
      this.syncTickRate(); // e.g. a SET_SPEED command changed the tick cadence
    }
    return result;
  }

  /**
   * Subscribe to snapshots. Ticking runs only while at least one subscriber is
   * connected (there's no point simulating an unobserved city locally; a real
   * server would tick continuously). Immediately pushes the current snapshot.
   */
  subscribe(cb: (snapshot: string) => void): () => void {
    this.subscribers.add(cb);
    this.ensureTicking();
    cb(serialize(this.state));
    return () => {
      this.subscribers.delete(cb);
      if (this.subscribers.size === 0) this.stopTicking();
    };
  }

  summary(): GameSummary {
    const players = Object.values(this.state.players);
    let claimed = 0;
    for (const key of Object.keys(this.state.plots)) {
      if (this.state.plots[Number(key)].ownerId) claimed++;
    }
    return {
      id: this.state.id,
      cityName: this.state.config.cityName,
      archetype: this.state.config.archetype,
      playerCount: players.length,
      maxPlayers: this.state.config.maxPlayers,
      plotCount: this.state.config.plotCount,
      claimedPlots: claimed,
      hasPassword: this.state.config.hasPassword,
      players: players.map((p) => ({ name: p.name, color: p.color })),
    };
  }

  /**
   * World-setup helper for pre-seeded demo cities. Directly places units on a
   * plot for a player, bypassing cost/validation — this represents server-side
   * seeding, not a player action, so it is intentionally not routed through the
   * reducer.
   */
  seedPlot(
    playerId: string,
    plotIndex: number,
    specs: { kind: UnitKind; col: number; row: number; occupancy?: number }[],
  ): void {
    const plot = this.state.plots[plotIndex];
    if (!plot) return;
    plot.ownerId = playerId;
    for (const s of specs) {
      const def = UNIT_DEFS[s.kind];
      plot.units.push({
        id: `u${this.state.nextUnitSeq++}`,
        kind: s.kind,
        col: s.col,
        row: s.row,
        width: def.width,
        occupancy: s.occupancy ?? 0,
      });
      // Seed the structural girders under each unit so the frame is consistent.
      for (let c = s.col; c < s.col + def.width; c++) {
        if (!plot.girders.some((g) => g.col === c && g.row === s.row)) {
          plot.girders.push({ col: c, row: s.row });
        }
      }
    }
    // Give each seeded shaft a car so the tower is actually serviced.
    if (!plot.cars) plot.cars = [];
    for (const run of elevatorRuns(plot)) {
      plot.cars.push({
        id: `car${this.state.nextUnitSeq++}`,
        col: run.col,
        position: run.from,
        dir: 1,
      });
    }
  }

  private ensureTicking(): void {
    if (this.timer !== null) return;
    this.tickSpeed = this.state.speed || 1;
    const intervalMs = (TICK_SECONDS / this.tickSpeed) * 1000;
    this.timer = setInterval(() => {
      advanceTick(this.state);
      this.broadcast();
    }, intervalMs);
  }

  private stopTicking(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Restart the tick loop if the game speed changed. */
  private syncTickRate(): void {
    if (this.timer === null) return;
    if ((this.state.speed || 1) !== this.tickSpeed) {
      this.stopTicking();
      this.ensureTicking();
    }
  }

  private broadcast(): void {
    const snapshot = serialize(this.state);
    for (const cb of this.subscribers) cb(snapshot);
  }
}
