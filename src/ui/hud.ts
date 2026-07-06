import {
  BUILD_ORDER,
  ELEVATOR_CAR_COST,
  GIRDER_BASE_COST,
  PLOT_COST_MIN,
  SPEED_OPTIONS,
  TICK_MINUTES,
  UNIT_DEFS,
  type RoomPrefs,
} from "../game/constants";
import { archetype } from "../game/archetypes";
import { gameTime } from "../game/clock";
import { claimCost } from "../game/economy";
import {
  elevatorAccess,
  viewRating,
  noiseRating,
  footTraffic,
  roomSatisfaction,
  type HeatmapKind,
} from "../game/heatmaps";
import { projectedNet } from "../game/tick";
import type { GameConnection } from "../net/connection";
import type { InspectRef } from "../input/input";
import type { Tool } from "../render/renderer";
import { flagSvg } from "./flags";

/** Toolbar swatch color for the girder tool (matches the in-canvas girders). */
const GIRDER_SWATCH = "#5c6470";

/**
 * HUD: the DOM-based in-game UI (city header, player chip, stats, build
 * toolbar, hint line). Like the canvas renderer it only READS state (through
 * the connection) and turns clicks into tool selections; it never mutates state.
 */
export class Hud {
  private cityFlagEl = must("city-flag");
  private cityEl = must("city-name");
  private clockEl = must("game-clock");
  private speedEl = must("speed-controls");
  private chipEl = must("player-chip");
  private statsEl = must("stats");
  private playersEl = must("players");
  private toolbarEl = must("toolbar");
  private claimBtnEl = must("claim-btn");
  private overlayEl = must("overlay");
  private inspectorEl = must("inspector");
  private hintEl = must("hint");

  /** Which heatmap overlay to draw (read by the render loop each frame). */
  heatmap: HeatmapKind = "none";

  constructor(
    private conn: GameConnection,
    private getSelected: () => Tool,
    private onSelect: (tool: Tool) => void,
    private onSpeed: (speed: number) => void,
    private getInspected: () => InspectRef | null,
  ) {
    this.buildToolbar();
    this.buildOverlay();
    this.buildHeader();
  }

  /** Render the right-hand room inspector panel (hover or pinned room). */
  renderInspector(): void {
    const info = this.getInspected();
    if (!info) {
      this.inspectorEl.classList.add("hidden");
      return;
    }
    const state = this.conn.getState();
    const plot = state.plots[info.plotIndex];
    const unit = plot?.units.find((u) => u.id === info.unitId);
    if (!plot || !unit) {
      this.inspectorEl.classList.add("hidden");
      return;
    }
    const def = UNIT_DEFS[unit.kind];

    // Ratings averaged across the room's footprint.
    let elev = 0, view = 0, noise = 0, foot = 0;
    for (let c = unit.col; c < unit.col + unit.width; c++) {
      elev += elevatorAccess(plot, c, unit.row);
      view += viewRating(plot, c, unit.row);
      noise += noiseRating(plot, c, unit.row);
      foot += footTraffic(plot, c, unit.row);
    }
    const n = unit.width;
    const elevStr = unit.row === 0 ? "—" : String(Math.round(elev / n));

    const revenue = def.incomeAtFull > 0;
    const gross = revenue ? Math.round(def.incomeAtFull * unit.occupancy) : 0;
    const net = gross - def.upkeep;
    const appeal = Math.round(roomSatisfaction(plot, unit) * 100);
    const prefs = prefsLabel(def.prefs);

    this.inspectorEl.innerHTML = `
      <div class="insp-title">${def.label} · Floor ${unit.row}${info.pinned ? ' <span class="pin">📌</span>' : ""}</div>
      <div class="insp-row"><span>Elevator</span><span>${elevStr}</span></div>
      <div class="insp-row"><span>View</span><span>${Math.round(view / n)}</span></div>
      <div class="insp-row"><span>Noise</span><span>${Math.round(noise / n)}</span></div>
      <div class="insp-row"><span>Foot traffic</span><span>${Math.round(foot / n)}</span></div>
      ${revenue ? `<div class="insp-row"><span>Appeal</span><span>${appeal}%</span></div>` : ""}
      ${prefs ? `<div class="insp-prefs">Prefers ${prefs}</div>` : ""}
      <div class="insp-row"><span>Occupancy</span><span>${revenue ? Math.round(unit.occupancy * 100) + "%" : "—"}</span></div>
      <div class="insp-row"><span>Income / ${TICK_MINUTES}min</span><span class="pos">${revenue ? "+$" + gross.toLocaleString() : "$0"}</span></div>
      <div class="insp-row"><span>Upkeep</span><span class="neg">-$${def.upkeep.toLocaleString()}</span></div>
      <div class="insp-row net"><span>Net</span><span class="${net >= 0 ? "pos" : "neg"}">${net < 0 ? "-" : "+"}$${Math.abs(net).toLocaleString()}</span></div>
      <div class="insp-hint">${info.pinned ? "Click again or Esc to close" : "Click to pin"}</div>`;
    this.inspectorEl.classList.remove("hidden");
  }

  private buildOverlay(): void {
    const opts: { k: HeatmapKind; label: string }[] = [
      { k: "none", label: "Off" },
      { k: "elevator", label: "Elevator" },
      { k: "view", label: "View" },
      { k: "noise", label: "Noise" },
      { k: "foot", label: "Traffic" },
    ];
    this.overlayEl.innerHTML = `<span class="overlay-title">Heatmap</span>`;
    for (const o of opts) {
      const btn = document.createElement("button");
      btn.className = "overlay-btn";
      btn.dataset.hm = o.k;
      btn.textContent = o.label;
      btn.addEventListener("click", () => {
        this.heatmap = o.k;
        this.update();
      });
      this.overlayEl.appendChild(btn);
    }
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

    // Speed multiplier buttons.
    this.speedEl.innerHTML = "";
    for (const n of SPEED_OPTIONS) {
      const btn = document.createElement("button");
      btn.className = "speed-btn";
      btn.dataset.speed = String(n);
      btn.textContent = `${n}×`;
      btn.title = `${n}× speed`;
      btn.addEventListener("click", () => this.onSpeed(n));
      this.speedEl.appendChild(btn);
    }
  }

  private buildToolbar(): void {
    this.toolbarEl.innerHTML = "";

    // Claim lives next to "My Plots" in the nav cluster, not in the build bar.
    this.claimBtnEl.addEventListener("click", () => this.toggle("claim"));
    this.claimBtnEl.title = `Claim an available plot (C) — from $${PLOT_COST_MIN.toLocaleString()}`;

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

    // Elevator car — placed inside a shaft (after the shaft is built).
    const car = document.createElement("button");
    car.className = "tool";
    car.dataset.tool = "elevatorCar";
    car.innerHTML = `
      <span class="swatch" style="background:#aab0b8"></span>
      <span class="tool-label">Elevator Car</span>
      <span class="tool-cost">$${ELEVATOR_CAR_COST.toLocaleString()}</span>
      <span class="tool-key">9</span>`;
    car.addEventListener("click", () => this.toggle("elevatorCar"));
    this.toolbarEl.appendChild(car);

    // Destroy tool last.
    const destroy = document.createElement("button");
    destroy.className = "tool";
    destroy.dataset.tool = "destroy";
    destroy.innerHTML = `
      <span class="swatch" style="background:#c84646">✕</span>
      <span class="tool-label">Destroy</span>
      <span class="tool-cost">+50% back</span>
      <span class="tool-key">X</span>`;
    destroy.addEventListener("click", () => this.toggle("destroy"));
    this.toolbarEl.appendChild(destroy);
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

    // In-game clock + active speed button.
    this.clockEl.textContent = gameTime(state.tick).label;
    const speed = state.speed || 1;
    for (const el of Array.from(this.speedEl.children) as HTMLElement[]) {
      el.classList.toggle("active", Number(el.dataset.speed) === speed);
    }
    for (const el of Array.from(this.overlayEl.children) as HTMLElement[]) {
      if (el.dataset.hm) el.classList.toggle("active", el.dataset.hm === this.heatmap);
    }
    this.renderInspector(); // keep pinned/hovered room stats live

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
      <div class="row"><span>Net / ${TICK_MINUTES}min</span>
        <span class="${netClass}">${net >= 0 ? "+" : ""}$${net.toLocaleString()}</span></div>
      <div class="row"><span>Plots owned</span><span>${myPlots.length}</span></div>
      <div class="row"><span>Girders</span><span>${myGirders}</span></div>
      <div class="row"><span>Units</span><span>${myUnits.length}</span></div>
      <div class="row"><span>Occupancy</span><span>${Math.round(avgOcc * 100)}%</span></div>`;

    this.renderPlayers(state, me);

    // Cheapest plot the player could currently claim (for the claim tool state).
    let cheapestClaim = Infinity;
    for (const key of Object.keys(state.plots)) {
      const p = state.plots[Number(key)];
      if (!p.ownerId && !p.feature)
        cheapestClaim = Math.min(cheapestClaim, claimCost(state, me, p.index));
    }

    // Claim button (in the nav cluster) selected/affordability state.
    this.claimBtnEl.classList.toggle("selected", this.getSelected() === "claim");
    this.claimBtnEl.classList.toggle("unaffordable", player.money < cheapestClaim);

    // Toolbar selected/affordability states.
    for (const el of Array.from(this.toolbarEl.children) as HTMLElement[]) {
      const tool = el.dataset.tool as Exclude<Tool, null>;
      const cost =
        tool === "girder"
          ? GIRDER_BASE_COST
          : tool === "elevatorCar"
            ? ELEVATOR_CAR_COST
            : tool === "destroy"
              ? 0 // destroying never costs money
              : tool === "claim"
                ? cheapestClaim // (claim now lives in the nav cluster, but stay total)
                : UNIT_DEFS[tool].cost;
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
      this.hintEl.textContent = `Girder mode — click, or click-and-drag to paint a run ($${GIRDER_BASE_COST} +$5/floor). Rooms need girders under them.`;
      this.hintEl.className = "panel";
    } else if (sel === "elevatorCar") {
      this.hintEl.textContent = `Elevator car ($${ELEVATOR_CAR_COST.toLocaleString()}) — click inside a shaft to add a car (up to 8 per shaft). A shaft with no car serves no floors.`;
      this.hintEl.className = "panel";
    } else if (sel === "destroy") {
      this.hintEl.textContent = `Destroy mode — click a room to demolish it (50% back), or a bare girder. Can't split an elevator shaft.`;
      this.hintEl.className = "panel";
    } else if (sel) {
      this.hintEl.textContent = `Placing ${UNIT_DEFS[sel].label} — needs girders underneath. Click a framed cell. Right-click sells. Esc deselects.`;
      this.hintEl.className = "panel";
    } else {
      this.hintEl.textContent = `Girders first (G, drag to paint), then rooms (1–7), a shaft (8) + its cars (9). C to claim. Drag or arrows to pan.`;
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

/** A short human phrase for a room's location preferences, e.g. "elevator · views · quiet". */
function prefsLabel(prefs: RoomPrefs | undefined): string {
  if (!prefs) return "";
  const parts: string[] = [];
  if (prefs.elevator) parts.push("elevator");
  if (prefs.view) parts.push("views");
  if (prefs.noise) parts.push("quiet");
  if (prefs.foot) parts.push(prefs.foot > 0 ? "foot traffic" : "calm");
  return parts.join(" · ");
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
