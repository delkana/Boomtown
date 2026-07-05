import {
  colorHexById,
  MAX_PLAYERS_LIMIT,
  MAX_PLOTS,
  MIN_PLOTS,
  PLAYER_COLORS,
  type ColorOption,
} from "../game/constants";
import type { UnitKind } from "../game/types";
import { AuthoritativeGame } from "./authoritativeGame";
import { LocalConnection, type GameConnection } from "./connection";
import type {
  CreateGameConfig,
  GameSummary,
  JoinRequest,
  PlayerSession,
} from "./protocol";

export type ConnectResult =
  | { ok: true; connection: GameConnection }
  | { ok: false; error: string };

/**
 * GameServer is the lobby + game-directory boundary. LocalServer implements it
 * in-process; a networked build swaps in a client that RPCs a real server over
 * the same interface. The lobby UI (src/ui/lobby.ts) depends only on this.
 */
export interface GameServer {
  getPalette(): ColorOption[];
  listGames(): GameSummary[];
  onDirectoryChange(cb: () => void): () => void;
  createGame(cfg: CreateGameConfig): ConnectResult;
  joinGame(req: JoinRequest): ConnectResult;
  /** Re-enter a game this client already joined (skips name/color prompt). */
  reconnect(gameId: string, playerId: string): ConnectResult;
}

/**
 * In-memory authoritative server. Holds every game, validates lobby requests
 * (the authority — the client's own checks are just UX), and hands back
 * connections. Seeds a few demo cities so the browse/join flow is meaningful.
 */
export class LocalServer implements GameServer {
  private games = new Map<string, AuthoritativeGame>();
  private directoryListeners = new Set<() => void>();

  constructor() {
    this.seedDemoCities();
  }

  getPalette(): ColorOption[] {
    return PLAYER_COLORS;
  }

  listGames(): GameSummary[] {
    return [...this.games.values()].map((g) => g.summary());
  }

  onDirectoryChange(cb: () => void): () => void {
    this.directoryListeners.add(cb);
    return () => this.directoryListeners.delete(cb);
  }

  createGame(cfg: CreateGameConfig): ConnectResult {
    const cityName = cfg.cityName.trim();
    if (!cityName) return err("City name is required");
    if (cityName.length > 28) return err("City name is too long");

    const plotCount = Math.floor(cfg.plotCount);
    if (plotCount < MIN_PLOTS || plotCount > MAX_PLOTS)
      return err(`Properties must be between ${MIN_PLOTS} and ${MAX_PLOTS}`);

    const maxPlayers = Math.floor(cfg.maxPlayers);
    if (maxPlayers < 1 || maxPlayers > MAX_PLAYERS_LIMIT)
      return err(`Max players must be between 1 and ${MAX_PLAYERS_LIMIT}`);

    const name = cfg.playerName.trim();
    if (!name) return err("Enter a player name");

    const colorHex = colorHexById(cfg.playerColor);
    if (!colorHex) return err("Pick a color");

    const password = cfg.password && cfg.password.length > 0 ? cfg.password : null;
    const id = this.uniqueId(cityName);
    const game = new AuthoritativeGame(
      id,
      { cityName, plotCount, maxPlayers, hasPassword: password !== null },
      password,
    );
    this.games.set(id, game);
    const player = game.addPlayer(name, colorHex);
    this.notifyDirectory();

    return { ok: true, connection: this.connect(game, player.id) };
  }

  joinGame(req: JoinRequest): ConnectResult {
    const game = this.games.get(req.gameId);
    if (!game) return err("Game no longer exists");

    if (game.password !== null && req.password !== game.password)
      return err("Wrong password");

    const players = Object.values(game.state.players);
    if (players.length >= game.state.config.maxPlayers)
      return err("Game is full");

    const name = req.playerName.trim();
    if (!name) return err("Enter a player name");
    if (players.some((p) => p.name.toLowerCase() === name.toLowerCase()))
      return err("That name is taken in this game");

    const colorHex = colorHexById(req.playerColor);
    if (!colorHex) return err("Pick a color");
    if (players.some((p) => p.color === colorHex))
      return err("That color is already taken");

    const player = game.addPlayer(name, colorHex);
    this.notifyDirectory();
    return { ok: true, connection: this.connect(game, player.id) };
  }

  reconnect(gameId: string, playerId: string): ConnectResult {
    const game = this.games.get(gameId);
    if (!game) return err("Game no longer exists");
    const player = game.state.players[playerId];
    if (!player) return err("You are no longer in this game");
    return { ok: true, connection: this.connect(game, player.id) };
  }

  // --- internals -----------------------------------------------------------

  private connect(game: AuthoritativeGame, playerId: string): GameConnection {
    const player = game.state.players[playerId];
    const session: PlayerSession = {
      gameId: game.state.id,
      playerId,
      playerName: player.name,
      colorHex: player.color,
    };
    return new LocalConnection(game, session);
  }

  private notifyDirectory(): void {
    for (const cb of this.directoryListeners) cb();
  }

  private uniqueId(cityName: string): string {
    const base =
      cityName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "city";
    let id = base;
    let n = 2;
    while (this.games.has(id)) id = `${base}-${n++}`;
    return id;
  }

  private seedDemoCities(): void {
    // "New Boston": open, no password, three established owners.
    const boston = new AuthoritativeGame(
      "new-boston",
      { cityName: "New Boston", plotCount: 14, maxPlayers: 8, hasPassword: false },
      null,
    );
    this.games.set("new-boston", boston);
    seedOwner(boston, "Vesta Corp", "#3fb96b", [2], [7]);
    seedOwner(boston, "Nakamura Holdings", "#4a86e0", [5, 6], [6, 9]);
    seedOwner(boston, "Rook & Vale", "#e79a2f", [10], [5]);

    // "Fort Lockwood": password-protected, smaller, two owners.
    const fort = new AuthoritativeGame(
      "fort-lockwood",
      { cityName: "Fort Lockwood", plotCount: 8, maxPlayers: 4, hasPassword: true },
      "1234",
    );
    this.games.set("fort-lockwood", fort);
    seedOwner(fort, "Onyx Group", "#c94ad1", [1], [6]);
    seedOwner(fort, "Brightside Ltd", "#e0503f", [4, 5], [8, 4]);
  }
}

function err(error: string): ConnectResult {
  return { ok: false, error };
}

/**
 * Seed one demo owner: register the player, then build a tower of `floors` on
 * each of the given plot indices (parallel `plotIndices`/`floorsList` arrays).
 */
function seedOwner(
  game: AuthoritativeGame,
  name: string,
  colorHex: string,
  plotIndices: number[],
  floorsList: number[],
): void {
  const player = game.addPlayer(name, colorHex);
  plotIndices.forEach((plotIndex, i) => {
    game.seedPlot(player.id, plotIndex, sampleTower(floorsList[i] ?? 5));
  });
}

/** A valid, supported tower layout `floors` high with pre-filled occupancy. */
function sampleTower(
  floors: number,
): { kind: UnitKind; col: number; row: number; occupancy?: number }[] {
  const specs: { kind: UnitKind; col: number; row: number; occupancy?: number }[] = [];
  specs.push({ kind: "lobby", col: 0, row: 0 });
  for (let r = 0; r < floors; r++) {
    specs.push({ kind: "elevator", col: 2, row: r });
    // Alternate offices and apartments up the two right-hand columns.
    const left: UnitKind = r % 2 === 0 ? "office" : "apartment";
    const right: UnitKind = r % 2 === 0 ? "apartment" : "office";
    specs.push({ kind: left, col: 4, row: r, occupancy: 0.6 + (r % 3) * 0.1 });
    specs.push({ kind: right, col: 6, row: r, occupancy: 0.55 + (r % 2) * 0.15 });
  }
  return specs;
}
