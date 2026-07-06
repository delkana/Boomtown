import { BUILD_ORDER, CLAIM_COST, TICK_SECONDS, UNIT_DEFS } from "../game/constants";
import { archetype } from "../game/archetypes";
import { projectedNet } from "../game/tick";
import type { GameConnection } from "../net/connection";
import type { Tool } from "../render/renderer";
import { flagSvg } from "./flags";

/**
 * HUD: the DOM-based in-game UI (city header, player chip, stats, build
 * toolbar, hint line). Like the canvas renderer it only READS state (through
 * the connection) and turns clicks into tool selections; it never mutates state.
 */
export class Hud {
  private cityFlagEl = must("city-flag");
  private cityEl = must("city-name");
  private chipEl = must("player-chip");
  private statsEl = must("stats");
  private toolbarEl = must("toolbar");
  private hintEl = must("hint");

  constructor(
    private conn: GameConnection,
    private getSelected: () => Tool,
    private onSelect: (tool: Tool) => void,
  ) {
    this.buildToolbar();
    this.buildHeader();
  }

  private buildHeader(): void {
    const state = this.conn.getState();
    this.cityFlagEl.innerHTML = flagSvg(state.config.archetype);
    this.cityEl.textContent = state.config.cityName;
    this.cityEl.title = archetype(state.config.archetype).name;
    const s = this.conn.session;
    this.chipEl.innerHTML = `<span class="dot" style="background:${s.colorHex}"></span>${escapeHtml(
      s.playerName,
    )}`;
  }

  private buildToolbar(): void {
    this.toolbarEl.innerHTML = "";

    // Claim tool first.
    const claim = document.createElement("button");
    claim.className = "tool";
    claim.dataset.tool = "claim";
    claim.innerHTML = `
      <span class="swatch claim-swatch">＋</span>
      <span class="tool-label">Claim Plot</span>
      <span class="tool-cost">$${CLAIM_COST.toLocaleString()}</span>
      <span class="tool-key">C</span>`;
    claim.addEventListener("click", () => this.toggle("claim"));
    this.toolbarEl.appendChild(claim);

    for (const kind of BUILD_ORDER) {
      const def = UNIT_DEFS[kind];
      const btn = document.createElement("button");
      btn.className = "tool";
      btn.dataset.tool = kind;
      btn.innerHTML = `
        <span class="swatch" style="background:${def.color}"></span>
        <span class="tool-label">${def.label}</span>
        <span class="tool-cost">$${def.cost.toLocaleString()}</span>
        <span class="tool-key">${def.hotkey}</span>`;
      btn.addEventListener("click", () => this.toggle(kind));
      this.toolbarEl.appendChild(btn);
    }
  }

  private toggle(tool: Exclude<Tool, null>): void {
    this.onSelect(this.getSelected() === tool ? null : tool);
  }

  /** Refresh readouts. Called on each snapshot and on selection change. */
  update(): void {
    const state = this.conn.getState();
    const me = this.conn.session.playerId;
    const player = state.players[me];
    if (!player) return;

    const myPlots = Object.values(state.plots).filter((p) => p.ownerId === me);
    const myUnits = myPlots.flatMap((p) => p.units);
    const net = myPlots.reduce((sum, p) => sum + projectedNet(p), 0);
    const revenueUnits = myUnits.filter((u) => UNIT_DEFS[u.kind].incomeAtFull > 0);
    const avgOcc =
      revenueUnits.length === 0
        ? 0
        : revenueUnits.reduce((s, u) => s + u.occupancy, 0) / revenueUnits.length;

    const netClass = net >= 0 ? "pos" : "neg";
    this.statsEl.innerHTML = `
      <div class="row big">$${player.money.toLocaleString()}</div>
      <div class="row"><span>Net / ${TICK_SECONDS}s</span>
        <span class="${netClass}">${net >= 0 ? "+" : ""}$${net.toLocaleString()}</span></div>
      <div class="row"><span>Plots owned</span><span>${myPlots.length}</span></div>
      <div class="row"><span>Units</span><span>${myUnits.length}</span></div>
      <div class="row"><span>Occupancy</span><span>${Math.round(avgOcc * 100)}%</span></div>
      <div class="row muted"><span>Tick</span><span>${state.tick}</span></div>`;

    // Toolbar selected/affordability states.
    for (const el of Array.from(this.toolbarEl.children) as HTMLElement[]) {
      const tool = el.dataset.tool as Exclude<Tool, null>;
      const cost = tool === "claim" ? CLAIM_COST : UNIT_DEFS[tool].cost;
      el.classList.toggle("selected", this.getSelected() === tool);
      el.classList.toggle("unaffordable", player.money < cost);
    }

    // Hint line.
    const err = this.conn.lastError();
    const sel = this.getSelected();
    if (err) {
      this.hintEl.textContent = `⚠ ${err}`;
      this.hintEl.className = "panel warn";
    } else if (sel === "claim") {
      this.hintEl.textContent = `Claim mode — click an "Available" plot to buy it. Then build on it.`;
      this.hintEl.className = "panel";
    } else if (sel) {
      this.hintEl.textContent = `Placing ${UNIT_DEFS[sel].label} — click a cell on a plot you own. Right-click sells. Esc deselects.`;
      this.hintEl.className = "panel";
    } else {
      this.hintEl.textContent = `Pick a tool (1–4, or C to claim). Drag or use arrow keys to pan the city.`;
      this.hintEl.className = "panel";
    }
  }
}

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} element`);
  return el;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}
