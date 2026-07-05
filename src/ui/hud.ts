import { BUILD_ORDER, TICK_SECONDS, UNIT_DEFS } from "../game/constants";
import { projectedNet } from "../game/tick";
import type { GameState, UnitKind } from "../game/types";

/**
 * HUD: the DOM-based UI (stats readout + build toolbar + hint line). Like the
 * canvas renderer, it only READS state and turns clicks into tool selections;
 * it never touches state directly. Kept in plain DOM so it stays framework-free.
 */
export class Hud {
  private statsEl: HTMLElement;
  private toolbarEl: HTMLElement;
  private hintEl: HTMLElement;

  constructor(
    private getState: () => GameState,
    private getSelected: () => UnitKind | null,
    private getLastError: () => string | null,
    private onSelect: (kind: UnitKind | null) => void,
  ) {
    this.statsEl = must("stats");
    this.toolbarEl = must("toolbar");
    this.hintEl = must("hint");
    this.buildToolbar();
  }

  private buildToolbar(): void {
    this.toolbarEl.innerHTML = "";
    for (const kind of BUILD_ORDER) {
      const def = UNIT_DEFS[kind];
      const btn = document.createElement("button");
      btn.className = "tool";
      btn.dataset.kind = kind;
      btn.innerHTML = `
        <span class="swatch" style="background:${def.color}"></span>
        <span class="tool-label">${def.label}</span>
        <span class="tool-cost">$${def.cost.toLocaleString()}</span>
        <span class="tool-key">${def.hotkey}</span>`;
      btn.addEventListener("click", () => {
        const next = this.getSelected() === kind ? null : kind;
        this.onSelect(next);
      });
      this.toolbarEl.appendChild(btn);
    }
  }

  /** Called on every state change / render. Cheap enough to run per frame. */
  update(): void {
    const state = this.getState();
    const player = state.players[state.localPlayerId];
    const plot = state.plots[0];
    const net = projectedNet(plot);
    const floors = plot.units.reduce((m, u) => Math.max(m, u.row + 1), 0);
    const revenueUnits = plot.units.filter(
      (u) => UNIT_DEFS[u.kind].incomeAtFull > 0,
    );
    const avgOcc =
      revenueUnits.length === 0
        ? 0
        : revenueUnits.reduce((s, u) => s + u.occupancy, 0) / revenueUnits.length;

    const netClass = net >= 0 ? "pos" : "neg";
    this.statsEl.innerHTML = `
      <div class="row big">$${player.money.toLocaleString()}</div>
      <div class="row"><span>Net / ${TICK_SECONDS}s</span>
        <span class="${netClass}">${net >= 0 ? "+" : ""}$${net.toLocaleString()}</span></div>
      <div class="row"><span>Floors</span><span>${floors}</span></div>
      <div class="row"><span>Units</span><span>${plot.units.length}</span></div>
      <div class="row"><span>Occupancy</span><span>${Math.round(avgOcc * 100)}%</span></div>
      <div class="row muted"><span>Tick</span><span>${state.tick}</span></div>`;

    // Toolbar selected state + affordability.
    for (const el of Array.from(this.toolbarEl.children) as HTMLElement[]) {
      const kind = el.dataset.kind as UnitKind;
      const def = UNIT_DEFS[kind];
      el.classList.toggle("selected", this.getSelected() === kind);
      el.classList.toggle("unaffordable", player.money < def.cost);
    }

    // Hint line: error takes priority, else a contextual tip.
    const err = this.getLastError();
    const sel = this.getSelected();
    if (err) {
      this.hintEl.textContent = `⚠ ${err}`;
      this.hintEl.className = "panel warn";
    } else if (sel) {
      const def = UNIT_DEFS[sel];
      this.hintEl.textContent = `Placing ${def.label} — click a cell. Right-click sells. Drag / arrow keys to pan. Esc to deselect.`;
      this.hintEl.className = "panel";
    } else {
      this.hintEl.textContent = `Pick a tool below (or press 1–4). Drag or use arrow keys to pan the city.`;
      this.hintEl.className = "panel";
    }
  }
}

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} element`);
  return el;
}
