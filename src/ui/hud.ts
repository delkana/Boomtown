import {
  BUILD_ORDER,
  GIRDER_BASE_COST,
  PLOT_COST_MIN,
  TICK_SECONDS,
  UNIT_DEFS,
} from "../game/constants";
import { archetype } from "../game/archetypes";
import { claimCost } from "../game/economy";
import { projectedNet } from "../game/tick";
import type { GameConnection } from "../net/connection";
import type { Tool } from "../render/renderer";
import { flagSvg } from "./flags";

/** Toolbar swatch color for the girder tool (matches the in-canvas girders). */
const GIRDER_SWATCH = "#b5793a";

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
  private playersEl = must("players");
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
      <span class="tool-cost">from $${PLOT_COST_MIN.toLocaleString()}</span>
      <span class="tool-key">C</span>`;
    claim.addEventListener("click", () => this.toggle("claim"));
    this.toolbarEl.appendChild(claim);

    // Girder (structural support) — built before any room.
    const girder = document.createElement("button");
    girder.className = "tool";
    girder.dataset.tool = "girder";
    girder.innerHTML = `
      <span class="swatch" style="background:${GIRDER_SWATCH}"></span>
      <span class="tool-label">Girder</span>
      <span class="tool-cost">from $${GIRDER_BASE_COST}</span>
      <span class="tool-key">G</span>`;
    girder.addEventListener("click", () => this.toggle("girder"));
    this.toolbarEl.appendChild(girder);

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
    const myGirders = myPlots.reduce((n, p) => n + (p.girders?.length ?? 0), 0);
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
      <div class="row"><span>Girders</span><span>${myGirders}</span></div>
      <div class="row"><span>Units</span><span>${myUnits.length}</span></div>
      <div class="row"><span>Occupancy</span><span>${Math.round(avgOcc * 100)}%</span></div>
      <div class="row muted"><span>Tick</span><span>${state.tick}</span></div>`;

    this.renderPlayers(state, me);

    // Cheapest plot the player could currently claim (for the claim tool state).
    let cheapestClaim = Infinity;
    for (const key of Object.keys(state.plots)) {
      const p = state.plots[Number(key)];
      if (!p.ownerId && !p.feature)
        cheapestClaim = Math.min(cheapestClaim, claimCost(state, me, p.index));
    }

    // Toolbar selected/affordability states.
    for (const el of Array.from(this.toolbarEl.children) as HTMLElement[]) {
      const tool = el.dataset.tool as Exclude<Tool, null>;
      const cost =
        tool === "claim" ? cheapestClaim : tool === "girder" ? GIRDER_BASE_COST : UNIT_DEFS[tool].cost;
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
      this.hintEl.textContent = `Claim mode — click an "Available" plot to buy it, then frame it.`;
      this.hintEl.className = "panel";
    } else if (sel === "girder") {
      this.hintEl.textContent = `Girder mode — build the frame first ($${GIRDER_BASE_COST} +$5/floor). Rooms need girders under them. Right-click removes.`;
      this.hintEl.className = "panel";
    } else if (sel) {
      this.hintEl.textContent = `Placing ${UNIT_DEFS[sel].label} — needs girders underneath. Click a framed cell. Right-click sells. Esc deselects.`;
      this.hintEl.className = "panel";
    } else {
      this.hintEl.textContent = `Girders first (G), then rooms (1–4). C to claim land. Drag or arrow keys to pan.`;
      this.hintEl.className = "panel";
    }
  }

  /** Roster of everyone in this city, with owner color and holdings. */
  private renderPlayers(state: ReturnType<GameConnection["getState"]>, me: string): void {
    const plotsByOwner: Record<string, number> = {};
    for (const key of Object.keys(state.plots)) {
      const owner = state.plots[Number(key)].ownerId;
      if (owner) plotsByOwner[owner] = (plotsByOwner[owner] ?? 0) + 1;
    }
    const roster = Object.values(state.players)
      .map((p) => ({ p, plots: plotsByOwner[p.id] ?? 0 }))
      .sort((a, b) => b.plots - a.plots || a.p.name.localeCompare(b.p.name));

    this.playersEl.innerHTML =
      `<div class="players-title">City · ${Object.keys(state.players).length} player${
        Object.keys(state.players).length === 1 ? "" : "s"
      }</div>` +
      roster
        .map(
          ({ p, plots }) => `
        <div class="player-row${p.id === me ? " me" : ""}">
          <span class="dot" style="background:${p.color}"></span>
          <span class="pname">${escapeHtml(p.name)}${p.id === me ? " (you)" : ""}</span>
          <span class="pplots">${plots} plot${plots === 1 ? "" : "s"}</span>
        </div>`,
        )
        .join("");
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
