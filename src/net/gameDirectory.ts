import {
  colorHexById,
  MAX_PLAYERS_LIMIT,
  MAX_PLOTS,
  MIN_PLOTS,
} from "../game/constants";
import { isArchetype } from "../game/archetypes";
import type { GameState, UnitKind } from "../game/types";
import { AuthoritativeGame } from "./authoritativeGame";
import type { CreateGameConfig, GameSummary, JoinRequest } from "./protocol";

/**
 * GameDirectory: the transport-agnostic heart of the server. It owns every
 * game, enforces every lobby rule (name/color/password/capacity/bounds), mints
 * reconnect tokens, and can (de)serialize the whole world for persistence.
 *
 * BOTH server implementations use this identical logic:
 *   - LocalServer (in-process, browser)  -> src/net/localServer.ts
 *   - wsServer    (networked, Node)       -> server/wsServer.ts
 * so the authoritative behavior can't drift between offline and online play.
 *
 * Reconnect tokens are kept in a side map, NOT in GameState — GameState is
 * broadcast to every client, so putting secrets there would leak them.
 */
export type DirResult =
  | { ok: true; game: AuthoritativeGame; playerId: string; token: string }
  | { ok: false; error: string };

interface StoredGame {
  state: GameState;
  password: string | null;
  tokens: [string, string][]; // [token, playerId]
}

export class GameDirectory {
  private games = new Map<string, AuthoritativeGame>();
  /** gameId -> (token -> playerId). Server-only secret. */
  private tokens = new Map<string, Map<string, string>>();
  private listeners = new Set<() => void>();

  constructor(opts: { seed?: boolean } = {}) {
    if (opts.seed ?? true) this.seedDemoCities();
  }

  getGame(id: string): AuthoritativeGame | undefined {
    return this.games.get(id);
  }

  summaries(): GameSummary[] {
    return [...this.games.values()].map((g) => g.summary());
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  create(cfg: CreateGameConfig): DirResult {
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

    if (!isArchetype(cfg.archetype)) return err("Pick a city archetype");

    const password = cfg.password && cfg.password.length > 0 ? cfg.password : null;
    const id = this.uniqueId(cityName);
    const game = AuthoritativeGame.create(
      id,
      { cityName, archetype: cfg.archetype, plotCount, maxPlayers, hasPassword: password !== null },
      password,
    );
    this.games.set(id, game);
    this.tokens.set(id, new Map());
    const player = game.addPlayer(name, colorHex);
    const token = this.mintToken(id, player.id);
    this.changed();
    return { ok: true, game, playerId: player.id, token };
  }

  join(req: JoinRequest): DirResult {
    const game = this.games.get(req.gameId);
    if (!game) return err("Game no longer exists");

    if (game.password !== null && req.password !== game.password)
      return err("Wrong password");

    const players = Object.values(game.state.players);
    if (players.length >= game.state.config.maxPlayers) return err("Game is full");

    const name = req.playerName.trim();
    if (!name) return err("Enter a player name");
    if (players.some((p) => p.name.toLowerCase() === name.toLowerCase()))
      return err("That name is taken in this game");

    const colorHex = colorHexById(req.playerColor);
    if (!colorHex) return err("Pick a color");
    if (players.some((p) => p.color === colorHex))
      return err("That color is already taken");

    const player = game.addPlayer(name, colorHex);
    const token = this.mintToken(req.gameId, player.id);
    this.changed();
    return { ok: true, game, playerId: player.id, token };
  }

  reconnect(gameId: string, token: string): DirResult {
    const game = this.games.get(gameId);
    if (!game) return err("Game no longer exists");
    const playerId = this.tokens.get(gameId)?.get(token);
    if (!playerId || !game.state.players[playerId])
      return err("You are no longer in this game");
    return { ok: true, game, playerId, token };
  }

  // --- persistence ---------------------------------------------------------

  serialize(): string {
    const out: StoredGame[] = [];
    for (const [id, game] of this.games) {
      out.push({
        state: game.state,
        password: game.password,
        tokens: [...(this.tokens.get(id) ?? new Map())],
      });
    }
    return JSON.stringify({ v: 1, games: out });
  }

  /** Replace the entire directory from a serialized snapshot. */
  load(json: string): void {
    const parsed = JSON.parse(json) as { v: number; games: StoredGame[] };
    this.games.clear();
    this.tokens.clear();
    for (const g of parsed.games) {
      // Tolerate saves from before a field existed (girders, speed).
      if (!g.state.speed) g.state.speed = 1;
      for (const key of Object.keys(g.state.plots)) {
        const plot = g.state.plots[Number(key)];
        if (!plot.girders) plot.girders = [];
      }
      const game = new AuthoritativeGame(g.state, g.password);
      this.games.set(g.state.id, game);
      this.tokens.set(g.state.id, new Map(g.tokens));
    }
    this.changed();
  }

  // --- internals -----------------------------------------------------------

  private mintToken(gameId: string, playerId: string): string {
    const token = randomToken();
    let map = this.tokens.get(gameId);
    if (!map) {
      map = new Map();
      this.tokens.set(gameId, map);
    }
    map.set(token, playerId);
    return token;
  }

  private changed(): void {
    for (const cb of this.listeners) cb();
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
    const angeles = AuthoritativeGame.create(
      "new-angeles",
      { cityName: "New Angeles", archetype: "pacifica", plotCount: 14, maxPlayers: 8, hasPassword: false },
      null,
    );
    this.games.set("new-angeles", angeles);
    this.tokens.set("new-angeles", new Map());
    seedOwner(angeles, "Redwood Spire Group", "#3fb96b", [2], [7]);
    seedOwner(angeles, "Neon Bay Holdings", "#4a86e0", [5, 6], [6, 9]);
    seedOwner(angeles, "Cascade Systems", "#e79a2f", [10], [5]);

    const kyoto = AuthoritativeGame.create(
      "neo-kyoto",
      { cityName: "Neo-Kyoto", archetype: "japan", plotCount: 8, maxPlayers: 4, hasPassword: false },
      null,
    );
    this.games.set("neo-kyoto", kyoto);
    this.tokens.set("neo-kyoto", new Map());
    seedOwner(kyoto, "Zaibatsu Prime", "#c94ad1", [1], [6]);
    seedOwner(kyoto, "Mirai Systems", "#e0503f", [4, 5], [8, 4]);

    const kosmograd = AuthoritativeGame.create(
      "kosmograd",
      { cityName: "Kosmograd", archetype: "ussr", plotCount: 12, maxPlayers: 6, hasPassword: false },
      null,
    );
    this.games.set("kosmograd", kosmograd);
    this.tokens.set("kosmograd", new Map());
    seedOwner(kosmograd, "Red October Combine", "#e0503f", [3, 4, 7], [9, 5, 7]);
  }
}

function err(error: string): DirResult {
  return { ok: false, error };
}

/** Random reconnect token (crypto if available, else a non-crypto fallback). */
function randomToken(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function seedOwner(
  game: AuthoritativeGame,
  name: string,
  colorHex: string,
  plotIndices: number[],
  floorsList: number[],
): void {
  const player = game.addPlayer(name, colorHex);
  plotIndices.forEach((plotIndex, i) => {
    const cols = game.state.plots[plotIndex]?.cols ?? 8;
    game.seedPlot(player.id, plotIndex, sampleTower(floorsList[i] ?? 5, cols));
  });
}

/** A valid, supported tower that fits within a plot `cols` wide. */
function sampleTower(
  floors: number,
  cols: number,
): { kind: UnitKind; col: number; row: number; occupancy?: number }[] {
  const specs: { kind: UnitKind; col: number; row: number; occupancy?: number }[] = [];
  specs.push({ kind: "lobby", col: 0, row: 0 });
  for (let r = 0; r < floors; r++) {
    specs.push({ kind: "elevator", col: 2, row: r });
    // Fill revenue columns starting at col 4, as many 2-wide units as fit.
    let slot = 0;
    for (let c = 4; c + 2 <= cols; c += 2, slot++) {
      const kind: UnitKind = (r + slot) % 2 === 0 ? "office" : "apartment";
      specs.push({ kind, col: c, row: r, occupancy: 0.55 + ((r + slot) % 3) * 0.12 });
    }
  }
  return specs;
}
