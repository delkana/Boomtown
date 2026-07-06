import {
  colorHexById,
  MAX_PLAYERS_LIMIT,
  MAX_PLOTS,
  MIN_PLOTS,
} from "../game/constants";
import { isArchetype } from "../game/archetypes";
import { elevatorRuns } from "../game/elevator";
import {
  isNearBackground,
  isFarBackground,
  migrateBackground,
  DEFAULT_NEAR,
  DEFAULT_FAR,
} from "../game/backgrounds";
import type { FeatureKind } from "../game/features";
import type { GameConfig, GameState, UnitKind } from "../game/types";
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
  /** Ids of the built-in demo cities — always re-seeded fresh, never persisted. */
  private seededIds = new Set<string>();

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

    const backgroundNear = isNearBackground(cfg.backgroundNear) ? cfg.backgroundNear : DEFAULT_NEAR;
    const backgroundFar = isFarBackground(cfg.backgroundFar) ? cfg.backgroundFar : DEFAULT_FAR;
    const latitude = clampLatitude(cfg.latitude);
    const password = cfg.password && cfg.password.length > 0 ? cfg.password : null;
    const id = this.uniqueId(cityName);
    const game = AuthoritativeGame.create(
      id,
      {
        cityName,
        archetype: cfg.archetype,
        backgroundNear,
        backgroundFar,
        latitude,
        plotCount,
        maxPlayers,
        hasPassword: password !== null,
      },
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

  /** Persist only PLAYER-created games; demo cities are re-seeded fresh on boot. */
  serialize(): string {
    const out: StoredGame[] = [];
    for (const [id, game] of this.games) {
      if (this.seededIds.has(id)) continue;
      out.push({
        state: game.state,
        password: game.password,
        tokens: [...(this.tokens.get(id) ?? new Map())],
      });
    }
    return JSON.stringify({ v: 2, games: out });
  }

  /**
   * MERGE saved games into the directory (does not clear). Demo cities keep the
   * freshly-seeded version, so changes to the built-in cities always show up.
   */
  load(json: string): void {
    const parsed = JSON.parse(json) as { v: number; games: StoredGame[] };
    for (const g of parsed.games) {
      if (this.seededIds.has(g.state.id)) continue; // don't clobber fresh demo cities
      // Tolerate saves from before a field existed (girders, speed, backdrops).
      if (!g.state.speed) g.state.speed = 1;
      const cfg = g.state.config as GameConfig & { background?: string };
      if (!cfg.backgroundNear || !cfg.backgroundFar) {
        const { near, far } = migrateBackground(cfg.background);
        cfg.backgroundNear = cfg.backgroundNear || near;
        cfg.backgroundFar = cfg.backgroundFar || far;
      }
      if (typeof cfg.latitude !== "number") cfg.latitude = 40;
      let carSeq = g.state.nextUnitSeq;
      for (const key of Object.keys(g.state.plots)) {
        const plot = g.state.plots[Number(key)];
        if (!plot.girders) plot.girders = [];
        // Backfill elevator cars: give each existing shaft one so towers built
        // before cars existed keep working.
        if (!plot.cars) {
          plot.cars = [];
          for (const run of elevatorRuns(plot)) {
            plot.cars.push({ id: `car${carSeq++}`, col: run.col, position: run.from, dir: 1 });
          }
        }
      }
      g.state.nextUnitSeq = carSeq;
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
    this.seedCity(
      "new-angeles", "New Angeles", "pacifica", { near: "palms", far: "ocean", latitude: 34 }, 22, 8, null,
      [
        { name: "Redwood Spire Group", color: "#3fb96b", floors: [7] },
        { name: "Neon Bay Holdings", color: "#4a86e0", floors: [6, 9] },
        { name: "Cascade Systems", color: "#e79a2f", floors: [5] },
      ],
      [
        { kind: "river", name: "Los Angeles River" },
        { kind: "river", name: "San Gabriel River" },
      ],
    );
    this.seedCity(
      "neo-kyoto", "Neo-Kyoto", "japan", { near: "skyline", far: "mountains", latitude: 35 }, 16, 6, null,
      [
        { name: "Zaibatsu Prime", color: "#c94ad1", floors: [6] },
        { name: "Mirai Systems", color: "#e0503f", floors: [8, 4] },
      ],
      [
        { kind: "river", name: "Kamo River" },
        { kind: "park", name: "Maruyama Park" },
      ],
    );
    this.seedCity(
      "kosmograd", "Kosmograd", "ussr", { near: "firs", far: "mountains", latitude: 56 }, 20, 8, null,
      [{ name: "Red October Combine", color: "#e0503f", floors: [9, 5, 7] }],
      [
        { kind: "river", name: "Moskva Canal" },
        { kind: "park", name: "Gorky Park" },
      ],
    );
    this.seedCity(
      "la-defense", "La Défense", "europa", { near: "oldtown", far: "hills", latitude: 49 }, 20, 8, null,
      [
        { name: "Rheinturm Group", color: "#f4c94b", floors: [10, 6] },
        { name: "Concorde Holdings", color: "#4a86e0", floors: [7] },
        { name: "Pan-Europa Dynamics", color: "#3fb96b", floors: [8] },
      ],
      [
        { kind: "river", name: "Seine Crossing" },
        { kind: "park", name: "Jardin des Tuileries" },
      ],
    );
  }

  /** Create a demo city and seed its owners onto BUILDABLE (non-feature) plots. */
  private seedCity(
    id: string,
    cityName: string,
    archetype: string,
    backdrop: { near: string; far: string; latitude: number },
    plotCount: number,
    maxPlayers: number,
    password: string | null,
    owners: { name: string; color: string; floors: number[] }[],
    featureOverrides?: { kind: FeatureKind; name: string }[],
  ): void {
    const game = AuthoritativeGame.create(
      id,
      {
        cityName,
        archetype,
        backgroundNear: backdrop.near,
        backgroundFar: backdrop.far,
        latitude: backdrop.latitude,
        plotCount,
        maxPlayers,
        hasPassword: password !== null,
      },
      password,
    );
    this.seededIds.add(id);
    this.games.set(id, game);
    this.tokens.set(id, new Map());

    // Optionally pin the city's feature plots to specific kinds/names.
    if (featureOverrides) {
      const featurePlots = Object.values(game.state.plots)
        .filter((p) => p.feature)
        .sort((a, b) => a.index - b.index);
      featureOverrides.forEach((ov, i) => {
        const fp = featurePlots[i];
        if (fp) {
          fp.feature = ov.kind;
          fp.name = ov.name;
        }
      });
    }

    const buildable = Object.values(game.state.plots)
      .filter((p) => !p.feature)
      .map((p) => p.index)
      .sort((a, b) => a - b);

    let next = 0;
    for (const owner of owners) {
      const player = game.addPlayer(owner.name, owner.color);
      for (const floors of owner.floors) {
        if (next >= buildable.length) break;
        const plotIndex = buildable[next++];
        game.seedPlot(player.id, plotIndex, sampleTower(floors, game.state.plots[plotIndex].cols));
      }
    }
  }
}

function err(error: string): DirResult {
  return { ok: false, error };
}

/** Clamp a latitude into the supported range (poles excluded a touch). */
function clampLatitude(lat: number): number {
  if (!Number.isFinite(lat)) return 40;
  return Math.max(-66, Math.min(66, Math.round(lat)));
}

/** Random reconnect token (crypto if available, else a non-crypto fallback). */
function randomToken(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
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
