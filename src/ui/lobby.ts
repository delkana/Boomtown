import {
  MAX_PLAYERS_LIMIT,
  MAX_PLOTS,
  MIN_PLOTS,
  type ColorOption,
} from "../game/constants";
import { ARCHETYPES, DEFAULT_ARCHETYPE, archetype, randomCityName } from "../game/archetypes";
import type { GameConnection } from "../net/connection";
import type { ConnectResult, GameServer } from "../net/localServer";
import type { GameSummary, PlayerSession } from "../net/protocol";
import { flagSvg } from "./flags";

/**
 * LobbyScreen: the pre-game DOM UI. Create a city or browse/join existing ones.
 *
 * It depends only on the GameServer interface, so it works unchanged whether
 * that server is the in-process LocalServer or a future networked client. The
 * "taken color" and "game full" rules are shown here for UX but ENFORCED by the
 * server (see LocalServer.createGame / joinGame).
 */
export class LobbyScreen {
  /** Games this browser has joined, so we can offer "Enter" without re-prompting. */
  private joined = new Map<string, PlayerSession>();
  private palette: ColorOption[];
  private createColor: string;
  private createArchetype = DEFAULT_ARCHETYPE;
  private joinColor: string | null = null;
  private joinTaken = new Set<string>();
  private joiningGameId: string | null = null;

  constructor(
    private root: HTMLElement,
    private server: GameServer,
    private onEnter: (conn: GameConnection) => void,
    private serverLabel = "Offline · local",
  ) {
    this.palette = server.getPalette();
    this.createColor = this.palette[0].id;
    this.joined = loadJoined();
    server.onDirectoryChange(() => this.renderList());
  }

  /** Full render of the lobby shell. Call once, then `show()` to reveal. */
  render(): void {
    this.root.innerHTML = SHELL;
    const status = this.root.querySelector("#lobby-status");
    if (status) status.textContent = `● ${this.serverLabel}`;
    this.mountCreateForm();
    this.mountModal();
    this.renderList();
  }

  /** Reveal the lobby (and refresh the live game list). */
  show(): void {
    this.root.classList.remove("hidden");
    this.renderList();
  }

  hide(): void {
    this.root.classList.add("hidden");
  }

  // --- Create form ---------------------------------------------------------

  private mountCreateForm(): void {
    const plots = this.q<HTMLInputElement>("#cf-plots");
    plots.min = String(MIN_PLOTS);
    plots.max = String(MAX_PLOTS);
    const max = this.q<HTMLInputElement>("#cf-max");
    max.max = String(MAX_PLAYERS_LIMIT);

    this.renderCreateColors();
    this.renderArchetypes();

    this.q("#cf-random").addEventListener("click", () => {
      this.q<HTMLInputElement>("#cf-city").value = randomCityName(this.createArchetype);
    });

    const pwToggle = this.q<HTMLInputElement>("#cf-pw-toggle");
    const pw = this.q<HTMLInputElement>("#cf-pw");
    pwToggle.addEventListener("change", () => pw.classList.toggle("hidden", !pwToggle.checked));

    this.q("#cf-create").addEventListener("click", () => this.submitCreate());
  }

  private renderArchetypes(): void {
    const grid = this.q("#cf-archetypes");
    grid.innerHTML = "";
    for (const a of ARCHETYPES) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "archetype-card" + (a.id === this.createArchetype ? " selected" : "");
      card.innerHTML = `<span class="flag">${flagSvg(a.id)}</span><span class="arch-name">${a.name}</span>`;
      card.addEventListener("click", () => {
        this.createArchetype = a.id;
        this.renderArchetypes();
        this.updateBlurb();
      });
      grid.appendChild(card);
    }
    this.updateBlurb();
  }

  private updateBlurb(): void {
    this.q("#cf-blurb").textContent = archetype(this.createArchetype).blurb;
  }

  private renderCreateColors(): void {
    this.renderColorGrid(this.q("#cf-colors"), () => this.createColor, new Set(), (id) => {
      this.createColor = id;
      this.renderCreateColors();
    });
  }

  private async submitCreate(): Promise<void> {
    const btn = this.q<HTMLButtonElement>("#cf-create");
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const result = await this.server.createGame({
        cityName: this.q<HTMLInputElement>("#cf-city").value,
        archetype: this.createArchetype,
        plotCount: Number(this.q<HTMLInputElement>("#cf-plots").value),
        maxPlayers: Number(this.q<HTMLInputElement>("#cf-max").value),
        password: this.q<HTMLInputElement>("#cf-pw-toggle").checked
          ? this.q<HTMLInputElement>("#cf-pw").value
          : null,
        playerName: this.q<HTMLInputElement>("#cf-name").value,
        playerColor: this.createColor,
      });
      this.finish(result, this.q("#cf-error"));
    } finally {
      btn.disabled = false;
    }
  }

  // --- Game list -----------------------------------------------------------

  private renderList(): void {
    const list = this.q("#game-list");
    const games = this.server.listGames();
    if (games.length === 0) {
      list.innerHTML = `<p class="empty">No cities yet — create one!</p>`;
      return;
    }
    list.innerHTML = games.map((g) => this.gameRow(g)).join("");
    for (const g of games) {
      const btn = list.querySelector<HTMLButtonElement>(`[data-join="${g.id}"]`);
      btn?.addEventListener("click", () => this.onJoinClick(g));
    }
  }

  private gameRow(g: GameSummary): string {
    const joined = this.joined.has(g.id);
    const full = g.playerCount >= g.maxPlayers;
    const dots = g.players
      .map((p) => `<span class="dot" title="${escapeHtml(p.name)}" style="background:${p.color}"></span>`)
      .join("");
    const label = joined ? "Enter" : full ? "Full" : "Join";
    const disabled = !joined && full ? "disabled" : "";
    return `
      <div class="game-row">
        <span class="flag list-flag">${flagSvg(g.archetype)}</span>
        <div class="game-info">
          <div class="game-title">${g.hasPassword ? "🔒 " : ""}${escapeHtml(g.cityName)}</div>
          <div class="game-meta">${escapeHtml(archetype(g.archetype).name)} · ${g.playerCount}/${g.maxPlayers} players · ${g.claimedPlots}/${g.plotCount} plots claimed</div>
          <div class="dots">${dots || '<span class="muted">no players yet</span>'}</div>
        </div>
        <button class="primary" data-join="${g.id}" ${disabled}>${label}</button>
      </div>`;
  }

  private async onJoinClick(g: GameSummary): Promise<void> {
    const existing = this.joined.get(g.id);
    if (existing) {
      const result = await this.server.reconnect(g.id, existing.token);
      if (!result.ok) {
        // Stale token (e.g. server restarted without persistence) — re-prompt.
        this.joined.delete(g.id);
        saveJoined(this.joined);
        this.openJoinModal(g);
        return;
      }
      this.finish(result, this.q("#cf-error"));
      return;
    }
    this.openJoinModal(g);
  }

  // --- Join modal ----------------------------------------------------------

  private mountModal(): void {
    this.q("#jm-cancel").addEventListener("click", () => this.closeJoinModal());
    this.q("#jm-join").addEventListener("click", () => this.submitJoin());
  }

  private openJoinModal(g: GameSummary): void {
    this.joiningGameId = g.id;
    this.joinTaken = new Set(g.players.map((p) => p.color));
    this.joinColor = this.palette.find((c) => !this.joinTaken.has(c.hex))?.id ?? null;

    this.q("#jm-title").textContent = `Join ${g.cityName}`;
    this.q<HTMLInputElement>("#jm-name").value = "";
    this.q<HTMLInputElement>("#jm-pw").value = "";
    this.q("#jm-pw-field").classList.toggle("hidden", !g.hasPassword);
    this.q("#jm-error").textContent = "";
    this.renderJoinColors();
    this.q("#join-modal").classList.remove("hidden");
  }

  private renderJoinColors(): void {
    this.renderColorGrid(this.q("#jm-colors"), () => this.joinColor, this.joinTaken, (id) => {
      this.joinColor = id;
      this.renderJoinColors();
    });
  }

  private closeJoinModal(): void {
    this.joiningGameId = null;
    this.q("#join-modal").classList.add("hidden");
  }

  private async submitJoin(): Promise<void> {
    if (!this.joiningGameId) return;
    const btn = this.q<HTMLButtonElement>("#jm-join");
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const result = await this.server.joinGame({
        gameId: this.joiningGameId,
        playerName: this.q<HTMLInputElement>("#jm-name").value,
        playerColor: this.joinColor ?? "",
        password: this.q<HTMLInputElement>("#jm-pw").value || null,
      });
      if (!result.ok) {
        this.q("#jm-error").textContent = result.error;
        return;
      }
      this.closeJoinModal();
      this.finish(result, this.q("#cf-error"));
    } finally {
      btn.disabled = false;
    }
  }

  // --- shared helpers ------------------------------------------------------

  private finish(result: ConnectResult, errorEl: HTMLElement): void {
    if (!result.ok) {
      errorEl.textContent = result.error;
      return;
    }
    errorEl.textContent = "";
    this.joined.set(result.connection.session.gameId, result.connection.session);
    saveJoined(this.joined);
    this.onEnter(result.connection);
  }

  private renderColorGrid(
    container: HTMLElement,
    getSelected: () => string | null,
    taken: Set<string>,
    onPick: (id: string) => void,
  ): void {
    container.innerHTML = "";
    for (const c of this.palette) {
      const isTaken = taken.has(c.hex);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "color-swatch";
      btn.style.background = c.hex;
      btn.title = isTaken ? `${c.name} (taken)` : c.name;
      if (isTaken) {
        btn.classList.add("taken");
        btn.disabled = true;
      }
      if (getSelected() === c.id) btn.classList.add("selected");
      btn.addEventListener("click", () => onPick(c.id));
      container.appendChild(btn);
    }
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T {
    const el = this.root.querySelector<T>(sel) ?? document.querySelector<T>(sel);
    if (!el) throw new Error(`Lobby element not found: ${sel}`);
    return el;
  }
}

const JOINED_KEY = "boomtown.joined.v1";

/** Load the map of games this browser has joined (with reconnect tokens). */
function loadJoined(): Map<string, PlayerSession> {
  try {
    const raw = localStorage.getItem(JOINED_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, PlayerSession>;
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

function saveJoined(joined: Map<string, PlayerSession>): void {
  try {
    localStorage.setItem(JOINED_KEY, JSON.stringify(Object.fromEntries(joined)));
  } catch {
    /* storage unavailable — rejoin-after-refresh is best-effort */
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

const SHELL = `
  <div class="lobby-wrap">
    <header class="lobby-header">
      <h1>Boomtown</h1>
      <p class="tagline">Claim plots, raise towers, share the skyline.
        <span id="lobby-status" class="lobby-status"></span>
      </p>
    </header>
    <div class="lobby-cols">
      <section class="lobby-card">
        <h2>Create a City</h2>
        <div class="field">City archetype
          <div id="cf-archetypes" class="archetype-grid"></div>
          <p id="cf-blurb" class="blurb"></p>
        </div>
        <label class="field">City name
          <div class="city-input-row">
            <input id="cf-city" type="text" maxlength="28" placeholder="Name your city" />
            <button id="cf-random" type="button" class="dice" title="Random name for this archetype">🎲</button>
          </div>
          <span class="field-note">Pick an archetype, then name it or roll a random one.</span>
        </label>
        <div class="field-row">
          <label class="field">Properties<input id="cf-plots" type="number" value="12" /></label>
          <label class="field">Max players<input id="cf-max" type="number" value="8" min="1" /></label>
        </div>
        <label class="field">Your name<input id="cf-name" type="text" maxlength="18" placeholder="Your name" /></label>
        <div class="field">Your color<div id="cf-colors" class="swatch-grid"></div></div>
        <label class="checkbox"><input id="cf-pw-toggle" type="checkbox" /> Password protected</label>
        <input id="cf-pw" type="text" class="hidden" placeholder="Password" />
        <button id="cf-create" class="primary big">Create &amp; Enter</button>
        <div id="cf-error" class="form-error"></div>
      </section>
      <section class="lobby-card">
        <h2>Join a City</h2>
        <div id="game-list" class="game-list"></div>
      </section>
    </div>
  </div>
  <div id="join-modal" class="modal hidden">
    <div class="modal-card">
      <h2 id="jm-title">Join</h2>
      <label class="field">Your name<input id="jm-name" type="text" maxlength="18" placeholder="Your name" /></label>
      <div class="field">Your color <span class="field-note">taken colors are disabled</span>
        <div id="jm-colors" class="swatch-grid"></div>
      </div>
      <div id="jm-pw-field" class="field hidden"><label>Password<input id="jm-pw" type="text" /></label></div>
      <div class="modal-actions">
        <button id="jm-cancel">Cancel</button>
        <button id="jm-join" class="primary">Join</button>
      </div>
      <div id="jm-error" class="form-error"></div>
    </div>
  </div>
`;
