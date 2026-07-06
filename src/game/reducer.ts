import type { Command } from "./commands";
import type { GameState, Plot, Unit, UnitKind } from "./types";
import { MAX_ROWS, UNIT_DEFS } from "./constants";
import { claimCost } from "./economy";

/**
 * The reducer applies a single command to the authoritative state.
 *
 * It is deterministic and side-effect free (no DOM, no time, no randomness),
 * so the same function runs on the server. It mutates the passed state in place
 * and returns a result describing success/failure.
 *
 * Every command is VALIDATED here — the client greys out illegal actions for
 * UX, but the reducer is the authority and never trusts the caller. This is
 * essential for multiplayer, where clients are untrusted: ownership, funds, and
 * placement legality are all enforced here.
 */

export interface CommandResult {
  ok: boolean;
  /** Human-readable reason on failure (surfaced as a UI hint). */
  error?: string;
}

export function applyCommand(state: GameState, cmd: Command): CommandResult {
  switch (cmd.type) {
    case "CLAIM_PLOT":
      return claimPlot(state, cmd);
    case "PLACE_UNIT":
      return placeUnit(state, cmd);
    case "SELL_UNIT":
      return sellUnit(state, cmd);
    default: {
      const _never: never = cmd;
      return { ok: false, error: `Unknown command ${(_never as Command).type}` };
    }
  }
}

function claimPlot(
  state: GameState,
  cmd: Extract<Command, { type: "CLAIM_PLOT" }>,
): CommandResult {
  const player = state.players[cmd.playerId];
  if (!player) return fail("No such player");
  const plot = state.plots[cmd.plotIndex];
  if (!plot) return fail("No such plot");
  if (plot.ownerId === cmd.playerId) return fail("You already own this plot");
  if (plot.ownerId) return fail("Plot already claimed by another player");

  const cost = claimCost(state, cmd.playerId, cmd.plotIndex);
  if (player.money < cost) return fail("Not enough money to claim");

  plot.ownerId = cmd.playerId;
  player.money -= cost;
  return ok();
}

function placeUnit(
  state: GameState,
  cmd: Extract<Command, { type: "PLACE_UNIT" }>,
): CommandResult {
  const player = state.players[cmd.playerId];
  if (!player) return fail("No such player");

  const plot = state.plots[cmd.plotIndex];
  if (!plot) return fail("No such plot");
  if (plot.ownerId === null) return fail("Claim this plot before building");
  if (plot.ownerId !== cmd.playerId) return fail("You don't own this plot");

  const def = UNIT_DEFS[cmd.kind];
  if (!def) return fail("Unknown unit type");

  // Bounds.
  if (cmd.row < 0 || cmd.row >= MAX_ROWS) return fail("Out of vertical bounds");
  if (cmd.col < 0 || cmd.col + def.width > plot.cols)
    return fail("Doesn't fit horizontally");

  // Placement rules.
  if (def.groundOnly && cmd.row !== 0) return fail(`${def.label} must be on the ground floor`);
  if (def.unique && plot.units.some((u) => u.kind === cmd.kind))
    return fail(`Only one ${def.label} allowed`);

  // A tower needs a lobby before anything else can go up.
  const hasLobby = plot.units.some((u) => u.kind === "lobby");
  if (!hasLobby && cmd.kind !== "lobby")
    return fail("Build a Lobby on the ground floor first");

  // Overlap check across the unit's full footprint.
  for (let c = cmd.col; c < cmd.col + def.width; c++) {
    if (isOccupied(plot, c, cmd.row)) return fail("Space is occupied");
  }

  // Support check: nothing floats — a cell must sit on the ground (row 0) or on
  // top of another unit.
  if (cmd.row > 0) {
    for (let c = cmd.col; c < cmd.col + def.width; c++) {
      if (!isOccupied(plot, c, cmd.row - 1)) return fail("Must build on solid support");
    }
  }

  // Affordability.
  if (player.money < def.cost) return fail("Not enough money");

  // Commit.
  const unit: Unit = {
    id: `u${state.nextUnitSeq++}`,
    kind: cmd.kind,
    col: cmd.col,
    row: cmd.row,
    width: def.width,
    occupancy: 0,
  };
  plot.units.push(unit);
  player.money -= def.cost;
  return ok();
}

function sellUnit(
  state: GameState,
  cmd: Extract<Command, { type: "SELL_UNIT" }>,
): CommandResult {
  const player = state.players[cmd.playerId];
  if (!player) return fail("No such player");
  const plot = state.plots[cmd.plotIndex];
  if (!plot || plot.ownerId !== cmd.playerId) return fail("Not your plot");

  const idx = plot.units.findIndex((u) => u.id === cmd.unitId);
  if (idx < 0) return fail("No such unit");

  const unit = plot.units[idx];
  const def = UNIT_DEFS[unit.kind];
  plot.units.splice(idx, 1);
  // Refund half the build cost.
  player.money += Math.floor(def.cost * 0.5);
  return ok();
}

/** Is cell (col,row) covered by any unit's footprint on this plot? */
export function isOccupied(plot: Plot, col: number, row: number): boolean {
  return plot.units.some(
    (u) => row === u.row && col >= u.col && col < u.col + u.width,
  );
}

/** The unit occupying a cell, if any. */
export function unitAt(plot: Plot, col: number, row: number): Unit | undefined {
  return plot.units.find(
    (u) => row === u.row && col >= u.col && col < u.col + u.width,
  );
}

function ok(): CommandResult {
  return { ok: true };
}
function fail(error: string): CommandResult {
  return { ok: false, error };
}

export type { UnitKind };
