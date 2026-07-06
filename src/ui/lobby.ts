import {
  MAX_PLAYERS_LIMIT,
  MAX_PLOTS,
  MIN_PLOTS,
  type ColorOption,
} from "../game/constants";
import {
  ARCHETYPES,
  DEFAULT_ARCHETYPE,
  archetype,
  randomCityName,
  suggestedLatitude,
} from "../game/archetypes";
import {
  NEAR_BACKGROUNDS,
  FAR_BACKGROUNDS,
  DEFAULT_NEAR,
  DEFAULT_FAR,
} from "../game/backgrounds";
import type { GameConnection } from "../net/connection";
import type { ConnectResult, GameServer } from "../net/localServer";
import type { AuthResult, GameSummary, Membership, PlayerSession, Profile } from "../net/protocol";
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
  private createNear = DEFAULT_NEAR;
  private createFar = DEFAULT_FAR;
  private createLatitude = 40;
  private joinColor: string | null = null;
  private joinTaken = new Set<string>();
  private joiningGameId: string | null = null;
  // Account state (online only). When signed in, your games follow you here.
  private profile: Profile | null = null;
  private sessionToken: string | null = null;
  private memberships: Membership[] = [];
  private authMode: "login" | "register" = "login";
  private authColor: string;

  constructor(
    private root: HTMLElement,
    private server: GameServer,
    private onEnter: (conn: GameConnection) => void,
    private serverLabel = "Offline · local",
  ) {
    this.palette = server.getPalette();
    this.createColor = this.palette[0].id;
    this.authColor = this.palette[0].id;
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
    this.mountAuth();
    this.renderAuthBar();
    this.renderList();
    void this.tryResume();
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
    this.renderBackdrops();

    const lat = this.q<HTMLInputElement>("#cf-lat");
    lat.value = String(this.createLatitude);
    lat.addEventListener("input", () => {
      this.createLatitude = Number(lat.value);
      this.updateLatitudeLabel();
    });
    this.updateLatitudeLabel();

    this.q("#cf-random").addEventListener("click", () => {
      const name = randomCityName(this.createArchetype);
      this.q<HTMLInputElement>("#cf-city").value = name;
      // Match the rolled city's real-world latitude.
      this.createLatitude = suggestedLatitude(name, this.createArchetype);
      lat.value = String(this.createLatitude);
      this.updateLatitudeLabel();
    });

    const pwToggle = this.q<HTMLInputElement>("#cf-pw-toggle");
    const pw = this.q<HTMLInputElement>("#cf-pw");
    pwToggle.addEventListener("change", () => pw.classList.toggle("hidden", !pwToggle.checked));

    // Create-city is a modal opened from the lobby.
    this.q("#open-create").addEventListener("click", () => {
      this.q("#cf-error").textContent = "";
      if (this.profile) {
        this.q<HTMLInputElement>("#cf-name").value = this.profile.displayName;
        this.createColor = this.profile.color;
        this.renderCreateColors();
      }
      this.q("#create-modal").classList.remove("hidden");
    });
    this.q("#cf-cancel").addEventListener("click", () => this.q("#create-modal").classList.add("hidden"));
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

  private renderBackdrops(): void {
    const build = (
      sel: string,
      list: { id: string; name: string }[],
      selected: () => string,
      pick: (id: string) => void,
    ): void => {
      const grid = this.q(sel);
      grid.innerHTML = "";
      for (const bg of list) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "bg-btn" + (bg.id === selected() ? " selected" : "");
        btn.textContent = bg.name;
        btn.addEventListener("click", () => {
          pick(bg.id);
          this.renderBackdrops();
        });
        grid.appendChild(btn);
      }
    };
    build("#cf-bg-near", NEAR_BACKGROUNDS, () => this.createNear, (id) => (this.createNear = id));
    build("#cf-bg-far", FAR_BACKGROUNDS, () => this.createFar, (id) => (this.createFar = id));
  }

  private updateLatitudeLabel(): void {
    this.q("#cf-lat-val").textContent = latitudeLabel(this.createLatitude);
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
        backgroundNear: this.createNear,
        backgroundFar: this.createFar,
        latitude: this.createLatitude,
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
    const member = this.membershipToken(g.id) !== null;
    const full = g.playerCount >= g.maxPlayers;
    const dots = g.players
      .map((p) => `<span class="dot" title="${escapeHtml(p.name)}" style="background:${p.color}"></span>`)
      .join("");
    const label = member ? "Enter" : full ? "Full" : "Join";
    const disabled = !member && full ? "disabled" : "";
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
    const token = this.membershipToken(g.id);
    if (token) {
      const result = await this.server.reconnect(g.id, token);
      if (!result.ok) {
        // Stale token (e.g. server restarted without persistence) — re-prompt.
        this.joined.delete(g.id);
        saveJoined(this.joined);
        this.memberships = this.memberships.filter((m) => m.gameId !== g.id);
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
    // Prefer the signed-in account's color if it's free, else the first free one.
    const preferHex = this.profile ? this.palette.find((c) => c.id === this.profile!.color)?.hex : undefined;
    this.joinColor =
      preferHex && !this.joinTaken.has(preferHex)
        ? this.profile!.color
        : (this.palette.find((c) => !this.joinTaken.has(c.hex))?.id ?? null);

    this.q("#jm-title").textContent = `Join ${g.cityName}`;
    this.q<HTMLInputElement>("#jm-name").value = this.profile?.displayName ?? "";
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

  // --- accounts ------------------------------------------------------------

  private mountAuth(): void {
    if (!this.server.supportsAccounts()) return;
    this.q("#am-cancel").addEventListener("click", () => this.q("#auth-modal").classList.add("hidden"));
    this.q("#am-submit").addEventListener("click", () => void this.submitAuth());
    this.q("#am-switch").addEventListener("click", () => this.openAuthModal(this.authMode === "login" ? "register" : "login"));
    // Submit on Enter from either field.
    for (const id of ["#am-user", "#am-pass", "#am-display"]) {
      this.q<HTMLInputElement>(id).addEventListener("keydown", (e) => {
        if ((e as KeyboardEvent).key === "Enter") void this.submitAuth();
      });
    }
  }

  private renderAuthBar(): void {
    const bar = this.q("#auth-bar");
    if (!this.server.supportsAccounts()) {
      bar.classList.add("hidden");
      return;
    }
    bar.classList.remove("hidden");
    if (this.profile) {
      bar.innerHTML = `<span class="auth-who">Signed in as <b>${escapeHtml(this.profile.displayName)}</b></span>
        <button id="ab-logout" class="linkish">Log out</button>`;
      this.q("#ab-logout").addEventListener("click", () => this.logout());
    } else {
      bar.innerHTML = `<button id="ab-login" class="linkish">Sign in</button>
        <span class="auth-sep">·</span>
        <button id="ab-register" class="linkish">Create account</button>`;
      this.q("#ab-login").addEventListener("click", () => this.openAuthModal("login"));
      this.q("#ab-register").addEventListener("click", () => this.openAuthModal("register"));
    }
  }

  private openAuthModal(mode: "login" | "register"): void {
    this.authMode = mode;
    const register = mode === "register";
    this.q("#am-title").textContent = register ? "Create account" : "Sign in";
    this.q<HTMLButtonElement>("#am-submit").textContent = register ? "Create account" : "Sign in";
    this.q("#am-register-only").classList.toggle("hidden", !register);
    this.q("#am-switch-text").textContent = register ? "Already have an account?" : "New here?";
    this.q<HTMLButtonElement>("#am-switch").textContent = register ? "Sign in" : "Create an account";
    this.q("#am-error").textContent = "";
    this.q<HTMLInputElement>("#am-pass").value = "";
    this.q<HTMLInputElement>("#am-pass").autocomplete = register ? "new-password" : "current-password";
    if (register) {
      this.authColor = this.palette[0].id;
      this.renderAuthColors();
    }
    this.q("#auth-modal").classList.remove("hidden");
    this.q<HTMLInputElement>("#am-user").focus();
  }

  private renderAuthColors(): void {
    this.renderColorGrid(this.q("#am-colors"), () => this.authColor, new Set(), (id) => {
      this.authColor = id;
      this.renderAuthColors();
    });
  }

  private async submitAuth(): Promise<void> {
    const btn = this.q<HTMLButtonElement>("#am-submit");
    if (btn.disabled) return;
    const username = this.q<HTMLInputElement>("#am-user").value;
    const password = this.q<HTMLInputElement>("#am-pass").value;
    btn.disabled = true;
    try {
      const result: AuthResult =
        this.authMode === "register"
          ? await this.server.register(username, password, this.q<HTMLInputElement>("#am-display").value, this.authColor)
          : await this.server.login(username, password);
      if (!result.ok) {
        this.q("#am-error").textContent = result.error;
        return;
      }
      this.q("#auth-modal").classList.add("hidden");
      this.setSignedIn(result);
    } finally {
      btn.disabled = false;
    }
  }

  /** On load, silently resume a stored session so you stay signed in. */
  private async tryResume(): Promise<void> {
    if (!this.server.supportsAccounts()) return;
    const token = localStorage.getItem(SESSION_KEY);
    if (!token) return;
    const result = await this.server.resume(token);
    if (result.ok) this.setSignedIn(result);
    else localStorage.removeItem(SESSION_KEY);
  }

  private setSignedIn(result: Extract<AuthResult, { ok: true }>): void {
    this.profile = result.profile;
    this.sessionToken = result.sessionToken;
    this.memberships = result.memberships;
    localStorage.setItem(SESSION_KEY, result.sessionToken);
    this.renderAuthBar();
    this.renderList();
  }

  private logout(): void {
    if (this.sessionToken) this.server.logout(this.sessionToken);
    this.profile = null;
    this.sessionToken = null;
    this.memberships = [];
    localStorage.removeItem(SESSION_KEY);
    this.renderAuthBar();
    this.renderList();
  }

  /** The reconnect token for a game the player belongs to (account or local), or null. */
  private membershipToken(gameId: string): string | null {
    const m = this.memberships.find((x) => x.gameId === gameId);
    if (m) return m.token;
    return this.joined.get(gameId)?.token ?? null;
  }

  // --- shared helpers ------------------------------------------------------

  private finish(result: ConnectResult, errorEl: HTMLElement): void {
    if (!result.ok) {
      errorEl.textContent = result.error;
      return;
    }
    errorEl.textContent = "";
    this.q("#create-modal").classList.add("hidden"); // close the create modal if open
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
const SESSION_KEY = "boomtown.session.v1";

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

/** "34°N · subtropical" style readout for a latitude slider value. */
function latitudeLabel(lat: number): string {
  const a = Math.abs(lat);
  const hemi = lat === 0 ? "" : lat > 0 ? "°N" : "°S";
  const zone =
    a < 10 ? "equatorial" : a < 24 ? "tropical" : a < 35 ? "subtropical" : a < 55 ? "temperate" : "subpolar";
  return `${a}${hemi || "°"} · ${zone}`;
}

const SHELL = `
  <div class="lobby-wrap">
    <header class="lobby-header">
      <h1>Boomtown</h1>
      <p class="tagline">Claim plots, raise towers, share the skyline.
        <span id="lobby-status" class="lobby-status"></span>
      </p>
      <div id="auth-bar" class="auth-bar hidden"></div>
    </header>
    <section class="lobby-card lobby-join">
      <div class="join-head">
        <h2>Cities</h2>
        <button id="open-create" class="primary">+ Create a City</button>
      </div>
      <div id="game-list" class="game-list"></div>
    </section>
  </div>

  <div id="auth-modal" class="modal hidden">
    <div class="modal-card auth-card">
      <h2 id="am-title">Sign in</h2>
      <label class="field">Username
        <input id="am-user" type="text" maxlength="20" placeholder="Username" autocomplete="username" />
      </label>
      <label class="field">Password
        <input id="am-pass" type="password" maxlength="64" placeholder="Password" autocomplete="current-password" />
      </label>
      <div id="am-register-only" class="hidden">
        <label class="field">Display name
          <input id="am-display" type="text" maxlength="24" placeholder="Shown to other players" />
        </label>
        <div class="field">Your color<div id="am-colors" class="swatch-grid"></div></div>
      </div>
      <div class="modal-actions">
        <button id="am-cancel">Cancel</button>
        <button id="am-submit" class="primary">Sign in</button>
      </div>
      <div id="am-error" class="form-error"></div>
      <p class="auth-switch"><span id="am-switch-text"></span> <button id="am-switch" type="button" class="linkish"></button></p>
    </div>
  </div>

  <div id="create-modal" class="modal hidden">
    <div class="modal-card create-card">
      <h2>Create a City</h2>
      <div class="field">City archetype
        <div id="cf-archetypes" class="archetype-grid"></div>
        <p id="cf-blurb" class="blurb"></p>
      </div>
      <div class="field-row">
        <div class="field">Backdrop — near
          <div id="cf-bg-near" class="bg-grid"></div>
        </div>
        <div class="field">Backdrop — far
          <div id="cf-bg-far" class="bg-grid"></div>
        </div>
      </div>
      <label class="field">Latitude
        <div class="lat-row">
          <input id="cf-lat" type="range" min="-66" max="66" step="1" value="40" />
          <span id="cf-lat-val" class="lat-val"></span>
        </div>
        <span class="field-note">Sets how day and night lengths swing through the seasons. 🎲 matches a real city.</span>
      </label>
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
      <div class="modal-actions">
        <button id="cf-cancel">Cancel</button>
        <button id="cf-create" class="primary">Create &amp; Enter</button>
      </div>
      <div id="cf-error" class="form-error"></div>
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
