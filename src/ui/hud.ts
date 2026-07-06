import {
  ELEVATOR_CAR_COST,
  GIRDER_BASE_COST,
  PLOT_COST_MIN,
  SPEED_OPTIONS,
  TICK_MINUTES,
  TICK_SECONDS,
  UNIT_DEFS,
  type RoomPrefs,
} from "../game/constants";
import { archetype } from "../game/archetypes";
import { FACADES, facadeById } from "../game/facades";
import { gameTimeFromMinutes } from "../game/clock";
import { claimCost } from "../game/economy";
import {
  elevatorAccess,
  viewRating,
  noiseRating,
  footTraffic,
  roomSatisfaction,
  type HeatmapKind,
} from "../game/heatmaps";
import { headcountLabel, hasTrades, tenantOpen, daysLabel, shiftLabel, lunchLabel, workScheduleLabel } from "../game/tenants";
import { buildingStars, starString } from "../game/ratings";
import { roomDisplayName } from "../game/naming";
import { elevatorRuns, runContaining } from "../game/elevator";
import { dayOfWeek } from "../game/clock";
import { projectedDailyNet } from "../game/tick";
import type { GameConnection } from "../net/connection";
import type { InspectRef } from "../input/input";
import type { Tool } from "../render/renderer";
import type { Tenant, UnitKind } from "../game/types";
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
  private toolSubmenuEl = must("tool-submenu");
  private claimBtnEl = must("claim-btn");
  private girderStylesEl = must("girder-styles");
  /** Which toolbar category's sub-menu is currently open. */
  private openCategory: string | null = null;
  /** Last selected tool, to auto-open its category only when it changes. */
  private lastSelectedTool: Tool = "claim";
  private overlayEl = must("overlay");
  private inspectorEl = must("inspector");
  private shaftPanelEl = must("shaft-panel");
  private hintEl = must("hint");

  /** Which heatmap overlay to draw (read by the render loop each frame). */
  heatmap: HeatmapKind = "none";
  /** Smooth-clock anchor: the authoritative tick and when we last saw it. */
  private clockAnchorTick = -1;
  private clockAnchorMs = 0;

  constructor(
    private conn: GameConnection,
    private getSelected: () => Tool,
    private onSelect: (tool: Tool) => void,
    private onSpeed: (speed: number) => void,
    private getInspected: () => InspectRef | null,
    private getGirderStyle: () => string,
    private onGirderStyle: (id: string) => void,
    private getInspectedShaft: () => { plotIndex: number; col: number } | null,
    private onSetCarHome: (plotIndex: number, col: number, home: number) => void,
    private onSetCarDoor: (plotIndex: number, col: number, side: "left" | "right") => void,
  ) {
    this.buildToolbar();
    this.buildGirderStyles();
    this.buildOverlay();
    this.buildHeader();
  }

  /** The girder facade sub-menu (shown only while the girder tool is active). */
  private buildGirderStyles(): void {
    this.girderStylesEl.innerHTML = `<span class="gs-title">Facade</span>`;
    for (const f of FACADES) {
      const btn = document.createElement("button");
      btn.className = "gs-btn";
      btn.dataset.style = f.id;
      btn.title = f.name;
      btn.innerHTML = `<span class="gs-swatch" style="background:${f.wall};border-color:${f.frame}"></span>${f.name}`;
      btn.addEventListener("click", () => {
        this.onGirderStyle(f.id);
        this.update();
      });
      this.girderStylesEl.appendChild(btn);
    }
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
    const appeal = Math.round(roomSatisfaction(plot, unit) * 100);
    const prefs = prefsLabel(def.prefs);
    // Facade/windows come from the girder this room is built on.
    const girder = plot.girders.find((g) => g.col === unit.col && g.row === unit.row);
    const facade = facadeById(girder?.style);
    const facadeVal = unit.row < 0 ? `${facade.name} · no windows` : facade.name;

    // Tenant + daily P&L.
    const tenant = unit.tenant ?? null;
    const hourF = ((state.tick * TICK_MINUTES) / 60) % 24;
    const day = dayOfWeek(state.tick);
    const dailyNet = (tenant ? tenant.dailyRent : 0) - def.upkeep;
    let tenantHtml = "";
    if (tenant) {
      const open = tenantOpen(tenant, hourF, day);
      const roster = tenant.workers ?? [];
      const rosterRows = roster
        .map((w) => {
          // Employees show job details; residents show their (external) work
          // schedule so you know when they're home; guests show just a name.
          const sched = workScheduleLabel(w);
          const meta =
            w.dailySalary > 0
              ? `<div class="roster-meta">${escapeHtml(w.title)} · $${w.dailySalary.toLocaleString()}/day</div>
                 <div class="roster-meta">${daysLabel(w.days)} · ${shiftLabel(w)} · lunch ${lunchLabel(w)}</div>`
              : sched
                ? `<div class="roster-meta">Works away · ${sched}</div>`
                : "";
          return `<div class="roster-row"><div class="roster-name">${escapeHtml(w.name)}</div>${meta}</div>`;
        })
        .join("");
      const rosterHtml = roster.length
        ? `<details class="insp-roster"><summary>${headcountLabel(unit.kind)} · ${roster.length}</summary><div class="roster-list">${rosterRows}</div></details>`
        : `<div class="insp-row"><span>${headcountLabel(unit.kind)}</span><span>${tenant.employees}</span></div>`;
      // The business's own daily books: rent it pays, wages it pays its staff, and
      // whether it clears a profit after both.
      const wages = roster.reduce((sum, w) => sum + w.dailySalary, 0);
      const bizNet = tenant.dailyRent - wages;
      tenantHtml = `
        <div class="insp-tenant">${escapeHtml(roomDisplayName(plot, unit) ?? tenant.name)}</div>
        <div class="insp-sub">${escapeHtml(tenant.trade)} · <span class="${open ? "pos" : "neg"}">${open ? "Open" : "Closed"}</span></div>
        <div class="insp-row"><span>Hours</span><span>${hr(tenant.openHour)}–${hr(tenant.closeHour)}</span></div>
        <div class="insp-row"><span>Days</span><span>${daysLabel(tenant.openDays)}</span></div>
        ${rosterHtml}
        ${visitorChart(unit.kind, tenant)}
        <div class="insp-row"><span>Rent / day</span><span class="pos">+$${tenant.dailyRent.toLocaleString()}</span></div>
        <div class="insp-row"><span>Wages / day</span><span class="neg">-$${wages.toLocaleString()}</span></div>
        <div class="insp-row"><span>Business net / day</span><span class="${bizNet >= 0 ? "pos" : "neg"}">${bizNet < 0 ? "-" : "+"}$${Math.abs(bizNet).toLocaleString()}</span></div>`;
    } else if (unit.kind === "frontdesk") {
      tenantHtml = `
        <div class="insp-tenant">${escapeHtml(roomDisplayName(plot, unit) ?? "Hotel Front Desk")}</div>
        <div class="insp-sub">Front desk · staffed around the clock</div>`;
    } else if (hasTrades(unit.kind)) {
      tenantHtml = `<div class="insp-sub">Vacant · seeking a tenant (${appeal}% appeal)</div>`;
    }

    const stars = buildingStars(plot);
    this.inspectorEl.innerHTML = `
      <div class="insp-title">${def.label} · Floor ${unit.row}${info.pinned ? ' <span class="pin">📌</span>' : ""}</div>
      <div class="insp-stars" title="Building rating — average room quality">${starString(stars)} <span class="muted">${stars.toFixed(1)}</span></div>
      ${tenantHtml}
      <div class="insp-row"><span>Facade</span><span>${facadeVal}</span></div>
      <div class="insp-row"><span>Elevator</span><span>${elevStr}</span></div>
      <div class="insp-row"><span>View</span><span>${Math.round(view / n)}</span></div>
      <div class="insp-row"><span>Noise</span><span>${Math.round(noise / n)}</span></div>
      <div class="insp-row"><span>Foot traffic</span><span>${Math.round(foot / n)}</span></div>
      ${revenue ? `<div class="insp-row"><span>Appeal</span><span>${appeal}%</span></div>` : ""}
      ${["office", "medical", "hotel", "store", "restaurant", "apartment"].includes(unit.kind) ? `<div class="insp-row"><span>Cleanliness</span><span>${Math.round(unit.cleanliness ?? 100)}%</span></div>` : ""}
      ${prefs ? `<div class="insp-prefs">Prefers ${prefs}</div>` : ""}
      <div class="insp-row"><span>Upkeep / day</span><span class="neg">-$${def.upkeep.toLocaleString()}</span></div>
      <div class="insp-row net"><span>Net / day</span><span class="${dailyNet >= 0 ? "pos" : "neg"}">${dailyNet < 0 ? "-" : "+"}$${Math.abs(dailyNet).toLocaleString()}</span></div>
      <div class="insp-hint">${info.pinned ? "Click again or Esc to close" : "Click to pin"}</div>`;
    this.inspectorEl.classList.remove("hidden");
  }

  /** Render both the room inspector and the shaft-settings panel. */
  renderInspect(): void {
    this.renderInspector();
    this.renderShaftPanel();
  }

  /** Settings panel for a clicked elevator shaft: set the cars' idle floor. */
  renderShaftPanel(): void {
    const ref = this.getInspectedShaft();
    if (!ref) {
      this.shaftPanelEl.classList.add("hidden");
      return;
    }
    const plot = this.conn.getState().plots[ref.plotIndex];
    const cars = (plot?.cars ?? []).filter((c) => c.col === ref.col);
    const run = plot
      ? runContaining(plot, ref.col, cars.length ? Math.round(cars[0].position) : 0) ??
        elevatorRuns(plot).find((r) => r.col === ref.col)
      : undefined;
    if (!plot || !run) {
      this.shaftPanelEl.classList.add("hidden");
      return;
    }
    const home = cars.length ? cars[0].home : run.from;
    const doorSide = (cars.length ? cars[0].doorSide : "right") ?? "right";
    const floorLabel = (f: number): string => (f === 0 ? "G" : f > 0 ? String(f) : `B${-f}`);
    let buttons = "";
    for (let f = run.to; f >= run.from; f--)
      buttons += `<button class="floor-btn${f === home ? " active" : ""}" data-floor="${f}">${floorLabel(f)}</button>`;

    this.shaftPanelEl.innerHTML = `
      <div class="insp-title">Elevator Bank</div>
      <div class="insp-sub">${cars.length} car${cars.length === 1 ? "" : "s"} · Floors ${floorLabel(run.from)}–${floorLabel(run.to)}</div>
      <div class="shaft-note">Idle return floor</div>
      <div class="floor-grid">${buttons}</div>
      <div class="shaft-note">Cabin door side</div>
      <div class="door-grid">
        <button class="door-btn${doorSide === "left" ? " active" : ""}" data-door="left">Left</button>
        <button class="door-btn${doorSide === "right" ? " active" : ""}" data-door="right">Right</button>
      </div>
      <div class="insp-hint">Cars wait here until a passenger calls them (coming soon). Esc to close.</div>`;
    for (const el of Array.from(this.shaftPanelEl.querySelectorAll<HTMLElement>("[data-floor]")))
      el.addEventListener("click", () => this.onSetCarHome(ref.plotIndex, ref.col, Number(el.dataset.floor)));
    for (const el of Array.from(this.shaftPanelEl.querySelectorAll<HTMLElement>("[data-door]")))
      el.addEventListener("click", () => this.onSetCarDoor(ref.plotIndex, ref.col, el.dataset.door as "left" | "right"));
    this.shaftPanelEl.classList.remove("hidden");
  }

  private buildOverlay(): void {
    const opts: { k: HeatmapKind; label: string }[] = [
      { k: "none", label: "Off" },
      { k: "elevator", label: "Elevator" },
      { k: "view", label: "View" },
      { k: "noise", label: "Noise" },
      { k: "foot", label: "Traffic" },
      { k: "cleanliness", label: "Clean" },
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

    // Category buttons each open a sub-menu of their tools.
    for (const cat of TOOL_CATEGORIES) {
      const btn = document.createElement("button");
      btn.className = "tool cat";
      btn.dataset.cat = cat.id;
      btn.innerHTML = `<span class="cat-icon">${cat.icon}</span><span class="tool-label">${cat.label}</span>`;
      btn.addEventListener("click", () => {
        this.openCategory = this.openCategory === cat.id ? null : cat.id;
        this.update();
      });
      this.toolbarEl.appendChild(btn);
    }

    // Destroy is always one click away.
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

  /** Rebuild the tool sub-menu for the open category (hidden if none). */
  private renderToolSubmenu(): void {
    const cat = TOOL_CATEGORIES.find((c) => c.id === this.openCategory);
    this.toolSubmenuEl.classList.toggle("hidden", !cat);
    this.toolSubmenuEl.innerHTML = "";
    if (!cat) return;
    for (const tool of cat.tools) {
      const m = toolMeta(tool);
      const btn = document.createElement("button");
      btn.className = "tool";
      btn.dataset.tool = tool;
      btn.innerHTML = `
        <span class="swatch" style="background:${m.swatch}">${m.mark ?? ""}</span>
        <span class="tool-label">${m.label}</span>
        <span class="tool-cost">${m.cost}</span>
        <span class="tool-key">${m.key}</span>`;
      btn.addEventListener("click", () => this.toggle(tool as Exclude<Tool, null>));
      this.toolSubmenuEl.appendChild(btn);
    }
  }

  private toggle(tool: Exclude<Tool, null>): void {
    this.onSelect(this.getSelected() === tool ? null : tool);
  }

  /**
   * Advance just the clock, interpolating game-minutes smoothly between the
   * coarse 5-minute economy ticks. Called every animation frame.
   */
  tickClock(): void {
    this.renderClock(this.conn.getState());
  }

  private renderClock(state: ReturnType<GameConnection["getState"]>): void {
    const speed = state.speed || 1;
    const elapsedSec = (performance.now() - this.clockAnchorMs) / 1000;
    const gameMinPerSec = (TICK_MINUTES / TICK_SECONDS) * speed;
    const progress = Math.min(TICK_MINUTES, Math.max(0, elapsedSec * gameMinPerSec));
    this.clockEl.textContent = gameTimeFromMinutes(state.tick * TICK_MINUTES + progress).label;
  }

  /** Refresh readouts. Called on each snapshot and on selection change. */
  update(): void {
    const state = this.conn.getState();
    const me = this.conn.session.playerId;
    const player = state.players[me];
    if (!player) return;

    // Re-anchor the smooth clock whenever the authoritative tick advances.
    if (state.tick !== this.clockAnchorTick) {
      this.clockAnchorTick = state.tick;
      this.clockAnchorMs = performance.now();
    }
    this.renderClock(state);
    const speed = state.speed || 1;
    for (const el of Array.from(this.speedEl.children) as HTMLElement[]) {
      el.classList.toggle("active", Number(el.dataset.speed) === speed);
    }
    for (const el of Array.from(this.overlayEl.children) as HTMLElement[]) {
      if (el.dataset.hm) el.classList.toggle("active", el.dataset.hm === this.heatmap);
    }
    this.renderInspect(); // keep pinned/hovered room + shaft panels live

    const myPlots = Object.values(state.plots).filter((p) => p.ownerId === me);
    const myUnits = myPlots.flatMap((p) => p.units);
    const myGirders = myPlots.reduce((n, p) => n + (p.girders?.length ?? 0), 0);
    const net = myPlots.reduce((sum, p) => sum + projectedDailyNet(p), 0);
    const leasable = myUnits.filter((u) => hasTrades(u.kind));
    const leased = leasable.filter((u) => u.tenant).length;
    const leasePct = leasable.length === 0 ? 0 : Math.round((leased / leasable.length) * 100);

    const netClass = net >= 0 ? "pos" : "neg";
    this.statsEl.innerHTML = `
      <div class="row big">$${player.money.toLocaleString()}</div>
      <div class="row"><span>Net / day</span>
        <span class="${netClass}">${net >= 0 ? "+" : ""}$${net.toLocaleString()}</span></div>
      <div class="row"><span>Plots owned</span><span>${myPlots.length}</span></div>
      <div class="row"><span>Girders</span><span>${myGirders}</span></div>
      <div class="row"><span>Rooms</span><span>${myUnits.length}</span></div>
      <div class="row"><span>Leased</span><span>${leased}/${leasable.length} · ${leasePct}%</span></div>`;

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

    // Girder facade sub-menu: visible only while the girder tool is active AND its
    // Construction sub-menu is open (so it doesn't linger after you close it).
    const showStyles = this.getSelected() === "girder" && this.openCategory === categoryOf("girder");
    this.girderStylesEl.classList.toggle("hidden", !showStyles);
    if (showStyles) {
      const cur = this.getGirderStyle();
      for (const el of Array.from(this.girderStylesEl.children) as HTMLElement[]) {
        if (el.dataset.style) el.classList.toggle("active", el.dataset.style === cur);
      }
    }

    // Toolbar: only auto-open a category when the SELECTED tool changes (e.g. a
    // hotkey) — manual category browsing/closing is otherwise left to the user.
    const sel0 = this.getSelected();
    if (sel0 !== this.lastSelectedTool) {
      this.lastSelectedTool = sel0;
      const c = categoryOf(sel0);
      if (c) this.openCategory = c;
      else if (sel0 === null) this.openCategory = null; // deselect exits the menu
    }
    this.renderToolSubmenu();

    // Category buttons: highlighted when their menu is open OR they hold the
    // selected tool (so you can see where the active tool lives while browsing).
    const selCat = categoryOf(sel0);
    for (const el of Array.from(this.toolbarEl.children) as HTMLElement[]) {
      if (el.dataset.cat) {
        el.classList.toggle("open", this.openCategory === el.dataset.cat);
        el.classList.toggle("selected", selCat === el.dataset.cat);
      } else if (el.dataset.tool === "destroy") {
        el.classList.toggle("selected", sel0 === "destroy");
      }
    }
    // Sub-menu tool buttons: selected + affordability.
    for (const el of Array.from(this.toolSubmenuEl.children) as HTMLElement[]) {
      const tool = el.dataset.tool ?? "";
      el.classList.toggle("selected", sel0 === tool);
      el.classList.toggle("unaffordable", player.money < toolCost(tool));
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
    } else if (sel === "elevator") {
      this.hintEl.textContent = `Elevator shaft ($${UNIT_DEFS.elevator.cost.toLocaleString()}) — a new shaft includes its first car (+$${ELEVATOR_CAR_COST.toLocaleString()}); add up to 8. Needs girders underneath.`;
      this.hintEl.className = "panel";
    } else if (sel) {
      this.hintEl.textContent = `Placing ${UNIT_DEFS[sel].label} — needs girders underneath. Click a framed cell. Use the Destroy tool to remove. Esc deselects.`;
      this.hintEl.className = "panel";
    } else {
      // Idle (no tool): no on-screen tip — keep the play area clean.
      this.hintEl.textContent = "";
      this.hintEl.className = "panel hidden";
    }
    // Lift the hint above whichever sub-menus are open so nothing overlaps.
    const girderOpen = sel === "girder"; // the facade strip shows too
    this.hintEl.classList.toggle("raised", this.openCategory !== null && !girderOpen);
    this.hintEl.classList.toggle("raised2", girderOpen);
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

/** Toolbar categories — each opens a sub-menu of its tools. */
const TOOL_CATEGORIES: { id: string; label: string; icon: string; tools: string[] }[] = [
  { id: "construction", label: "Construction", icon: "🏗", tools: ["girder", "lobby", "elevator", "elevatorCar"] },
  { id: "offices", label: "Offices", icon: "🏢", tools: ["office", "medical", "janitor"] },
  { id: "apartments", label: "Apartments", icon: "🏠", tools: ["apartment", "laundromat"] },
  { id: "hotels", label: "Hotels", icon: "🛎", tools: ["frontdesk", "hotel", "housekeeping"] },
  { id: "retail", label: "Retail", icon: "🛍", tools: ["store", "storeroom"] },
  { id: "food", label: "Food", icon: "🍽", tools: ["restaurant", "bussing", "vending"] },
];

/** The category id that contains a tool, or null. */
function categoryOf(tool: Tool): string | null {
  if (!tool) return null;
  return TOOL_CATEGORIES.find((c) => c.tools.includes(tool))?.id ?? null;
}

/** Display metadata (swatch/label/cost/hotkey) for a tool button. */
function toolMeta(tool: string): { swatch: string; label: string; cost: string; key: string; mark?: string } {
  if (tool === "girder") return { swatch: GIRDER_SWATCH, label: "Girder", cost: `from $${GIRDER_BASE_COST}`, key: "G" };
  if (tool === "elevatorCar")
    return { swatch: "#aab0b8", label: "Elevator Car", cost: `$${ELEVATOR_CAR_COST.toLocaleString()}`, key: "9" };
  const def = UNIT_DEFS[tool as keyof typeof UNIT_DEFS];
  return { swatch: def.color, label: def.label, cost: `$${def.cost.toLocaleString()}`, key: def.hotkey };
}

/** Cost used for affordability greying of a tool button. */
function toolCost(tool: string): number {
  if (tool === "girder") return GIRDER_BASE_COST;
  if (tool === "elevatorCar") return ELEVATOR_CAR_COST;
  const def = UNIT_DEFS[tool as keyof typeof UNIT_DEFS];
  return def ? def.cost : 0;
}

/** Format an hour (0..24) as "9am" / "5pm" / "12am". */
function hr(h: number): string {
  const x = ((h % 24) + 24) % 24;
  const ap = x < 12 ? "am" : "pm";
  const h12 = x % 12 === 0 ? 12 : x % 12;
  return `${h12}${ap}`;
}

/** Which businesses show a daily-visitor chart, and what their patrons are called. */
const VISITOR_LABELS: Partial<Record<UnitKind, { title: string; noun: string }>> = {
  store: { title: "Daily shoppers", noun: "shoppers" },
  restaurant: { title: "Daily diners", noun: "diners" },
  medical: { title: "Daily patients", noun: "patients" },
};

/**
 * A collapsed bar chart of a business's recent daily visitor counts (shoppers /
 * diners / patients). Empty until the first midnight snapshot lands. Exported
 * for unit testing the markup.
 */
export function visitorChart(kind: UnitKind, tenant: Tenant): string {
  const meta = VISITOR_LABELS[kind];
  if (!meta) return "";
  const vis = tenant.visitors ?? [];
  if (vis.length === 0) {
    return `<details class="insp-visitors"><summary>${meta.title}</summary><div class="vchart-empty">No data yet — counts appear after midnight.</div></details>`;
  }
  const recent = vis.slice(-10);
  const max = Math.max(1, ...recent);
  const latest = recent[recent.length - 1];
  const avg = Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);
  const bars = recent
    .map((n) => `<div class="vbar" style="height:${Math.round(6 + (n / max) * 38)}px" title="${n} ${meta.noun}"></div>`)
    .join("");
  return `<details class="insp-visitors"><summary>${meta.title} · ${latest} <span class="muted">(avg ${avg})</span></summary>
    <div class="vchart">${bars}</div>
    <div class="vchart-axis"><span>${recent.length}d ago</span><span>today</span></div></details>`;
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
