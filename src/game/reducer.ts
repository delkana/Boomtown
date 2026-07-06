import type { Command } from "./commands";
import type { GameState, Plot, Unit, UnitKind } from "./types";
import { ELEVATOR_CAR_COST, MAX_DEPTH, MAX_ROWS, SPEED_OPTIONS, UNIT_DEFS } from "./constants";
import { claimCost, girderCost, undergroundMultiplier } from "./economy";
import { featureLabel } from "./features";
import { isFacade } from "./facades";
import { MAX_CARS_PER_SHAFT, autoCarNeeded, carsInRun, nearestCar, pruneOrphanCars, runContaining } from "./elevator";

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
    case "SET_SPEED":
      return setSpeed(state, cmd);
    case "PLACE_GIRDER":
      return placeGirder(state, cmd);
    case "SELL_GIRDER":
      return sellGirder(state, cmd);
    case "PLACE_UNIT":
      return placeUnit(state, cmd);
    case "SELL_UNIT":
      return sellUnit(state, cmd);
    case "PLACE_ELEVATOR_CAR":
      return placeElevatorCar(state, cmd);
    case "SELL_ELEVATOR_CAR":
      return sellElevatorCar(state, cmd);
    case "SET_CAR_HOME":
      return setCarHome(state, cmd);
    default: {
      const _never: never = cmd;
      return { ok: false, error: `Unknown command ${(_never as Command).type}` };
    }
  }
}

function ownedBuildablePlot(
  state: GameState,
  playerId: string,
  plotIndex: number,
): { ok: true; plot: Plot } | { ok: false; error: string } {
  const player = state.players[playerId];
  if (!player) return { ok: false, error: "No such player" };
  const plot = state.plots[plotIndex];
  if (!plot) return { ok: false, error: "No such plot" };
  if (plot.feature) return { ok: false, error: `${featureLabel(plot.feature)} — nothing can be built here` };
  if (plot.ownerId === null) return { ok: false, error: "Claim this plot before building" };
  if (plot.ownerId !== playerId) return { ok: false, error: "You don't own this plot" };
  return { ok: true, plot };
}

function setSpeed(
  state: GameState,
  cmd: Extract<Command, { type: "SET_SPEED" }>,
): CommandResult {
  if (!state.players[cmd.playerId]) return fail("No such player");
  const speed = Math.round(cmd.speed);
  if (!SPEED_OPTIONS.includes(speed)) return fail("Invalid speed");
  state.speed = speed;
  return ok();
}

function placeGirder(
  state: GameState,
  cmd: Extract<Command, { type: "PLACE_GIRDER" }>,
): CommandResult {
  const owned = ownedBuildablePlot(state, cmd.playerId, cmd.plotIndex);
  if (!owned.ok) return fail(owned.error);
  const plot = owned.plot;
  const player = state.players[cmd.playerId];

  if (cmd.row >= MAX_ROWS) return fail("Out of vertical bounds");
  if (cmd.row < -MAX_DEPTH) return fail("The lowest level is reserved for the subway");
  if (cmd.col < 0 || cmd.col >= plot.cols) return fail("Outside the plot");
  if (hasGirder(plot, cmd.col, cmd.row)) return fail("Support already here");
  // A girder needs the ground or a girder below — OR a single-tile overhang off
  // a directly-supported neighbor (a cantilever, if you want the architecture).
  if (!girderSupported(plot, cmd.col, cmd.row))
    return fail("Girders need support below (a 1-tile overhang is allowed)");

  const cost = girderCost(cmd.row);
  if (player.money < cost) return fail("Not enough money");

  const girder: { col: number; row: number; style?: string } = { col: cmd.col, row: cmd.row };
  if (cmd.style && isFacade(cmd.style)) girder.style = cmd.style; // cosmetic; validated
  plot.girders.push(girder);
  player.money -= cost;
  return ok();
}

function sellGirder(
  state: GameState,
  cmd: Extract<Command, { type: "SELL_GIRDER" }>,
): CommandResult {
  const owned = ownedBuildablePlot(state, cmd.playerId, cmd.plotIndex);
  if (!owned.ok) return fail(owned.error);
  const plot = owned.plot;
  const player = state.players[cmd.playerId];

  const idx = plot.girders.findIndex((g) => g.col === cmd.col && g.row === cmd.row);
  if (idx < 0) return fail("No support here");
  if (isOccupied(plot, cmd.col, cmd.row)) return fail("Remove the room on this girder first");

  // Tentatively remove it; block if that would leave any other girder floating
  // (covers girders resting directly on top and 1-tile overhangs off this one).
  const [removed] = plot.girders.splice(idx, 1);
  const orphaned = plot.girders.some((g) => !girderSupported(plot, g.col, g.row));
  if (orphaned) {
    plot.girders.splice(idx, 0, removed);
    return fail("That would leave girders unsupported");
  }

  player.money += Math.floor(girderCost(cmd.row) * 0.5);
  return ok();
}

function claimPlot(
  state: GameState,
  cmd: Extract<Command, { type: "CLAIM_PLOT" }>,
): CommandResult {
  const player = state.players[cmd.playerId];
  if (!player) return fail("No such player");
  const plot = state.plots[cmd.plotIndex];
  if (!plot) return fail("No such plot");
  if (plot.feature) return fail(`${featureLabel(plot.feature)} — can't be claimed`);
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
  const owned = ownedBuildablePlot(state, cmd.playerId, cmd.plotIndex);
  if (!owned.ok) return fail(owned.error);
  const plot = owned.plot;
  const player = state.players[cmd.playerId];

  const def = UNIT_DEFS[cmd.kind];
  if (!def) return fail("Unknown unit type");

  // Bounds (rooms may go underground down to -MAX_DEPTH).
  if (cmd.row >= MAX_ROWS) return fail("Out of vertical bounds");
  if (cmd.row < -MAX_DEPTH) return fail("The lowest level is reserved for the subway");
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

  // Overlap + support: every footprint cell must be free of other rooms AND
  // already have a girder (you build the structural frame first).
  for (let c = cmd.col; c < cmd.col + def.width; c++) {
    if (isOccupied(plot, c, cmd.row)) return fail("Space is occupied");
    if (!hasGirder(plot, c, cmd.row)) return fail("Build structural supports (girders) here first");
  }

  // Affordability — underground rooms cost more per level down. A brand-new
  // elevator shaft comes bundled with its first car (so it services floors
  // immediately); extending an existing shaft does not.
  const roomCost = def.cost * undergroundMultiplier(cmd.row);
  const withCar = cmd.kind === "elevator" && autoCarNeeded(plot, cmd.col, cmd.row);
  const carCost = withCar ? ELEVATOR_CAR_COST : 0;
  if (player.money < roomCost + carCost) return fail("Not enough money");

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
  player.money -= roomCost + carCost;
  if (withCar) {
    if (!plot.cars) plot.cars = [];
    plot.cars.push({ id: `car${state.nextUnitSeq++}`, col: cmd.col, position: cmd.row, home: cmd.row });
  }
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
  // Can't break an elevator shaft in half — remove from the top down.
  if (
    unit.kind === "elevator" &&
    plot.units.some((u) => u.kind === "elevator" && u.col === unit.col && u.row === unit.row + 1)
  ) {
    return fail("Can't split the elevator shaft — remove the elevator above first");
  }

  const def = UNIT_DEFS[unit.kind];
  plot.units.splice(idx, 1);
  // Removing an elevator segment can shrink a shaft out from under a car.
  if (unit.kind === "elevator") pruneOrphanCars(plot);
  // Refund half of what was paid (underground rooms cost more).
  player.money += Math.floor(def.cost * undergroundMultiplier(unit.row) * 0.5);
  return ok();
}

function placeElevatorCar(
  state: GameState,
  cmd: Extract<Command, { type: "PLACE_ELEVATOR_CAR" }>,
): CommandResult {
  const owned = ownedBuildablePlot(state, cmd.playerId, cmd.plotIndex);
  if (!owned.ok) return fail(owned.error);
  const plot = owned.plot;
  const player = state.players[cmd.playerId];

  const run = runContaining(plot, cmd.col, cmd.row);
  if (!run) return fail("Elevator cars go inside an elevator shaft");
  if (carsInRun(plot, run).length >= MAX_CARS_PER_SHAFT)
    return fail(`A shaft holds at most ${MAX_CARS_PER_SHAFT} cars`);
  if (player.money < ELEVATOR_CAR_COST) return fail("Not enough money");

  if (!plot.cars) plot.cars = [];
  // A new car idles at the floor it was installed on.
  plot.cars.push({ id: `car${state.nextUnitSeq++}`, col: cmd.col, position: cmd.row, home: cmd.row });
  player.money -= ELEVATOR_CAR_COST;
  return ok();
}

function setCarHome(
  state: GameState,
  cmd: Extract<Command, { type: "SET_CAR_HOME" }>,
): CommandResult {
  const owned = ownedBuildablePlot(state, cmd.playerId, cmd.plotIndex);
  if (!owned.ok) return fail(owned.error);
  const plot = owned.plot;

  const cars = (plot.cars ?? []).filter((c) => c.col === cmd.col);
  if (cars.length === 0) return fail("No elevator cars in this shaft");
  const run = runContaining(plot, cmd.col, Math.round(cars[0].position));
  if (!run) return fail("No shaft here");
  const home = Math.max(run.from, Math.min(run.to, Math.round(cmd.home)));
  for (const c of cars) {
    if (Math.round(c.position) >= run.from && Math.round(c.position) <= run.to) c.home = home;
  }
  return ok();
}

function sellElevatorCar(
  state: GameState,
  cmd: Extract<Command, { type: "SELL_ELEVATOR_CAR" }>,
): CommandResult {
  const player = state.players[cmd.playerId];
  if (!player) return fail("No such player");
  const plot = state.plots[cmd.plotIndex];
  if (!plot || plot.ownerId !== cmd.playerId) return fail("Not your plot");

  const car = nearestCar(plot, cmd.col, cmd.row);
  if (!car) return fail("No elevator car here");
  plot.cars = (plot.cars ?? []).filter((c) => c.id !== car.id);
  player.money += Math.floor(ELEVATOR_CAR_COST * 0.5);
  return ok();
}

/** Is cell (col,row) covered by any unit's footprint on this plot? */
export function isOccupied(plot: Plot, col: number, row: number): boolean {
  return plot.units.some(
    (u) => row === u.row && col >= u.col && col < u.col + u.width,
  );
}

/** Does cell (col,row) have a structural girder? */
export function hasGirder(plot: Plot, col: number, row: number): boolean {
  return (plot.girders ?? []).some((g) => g.col === col && g.row === row);
}

/**
 * A girder is "directly supported" if it sits on the ground (row 0), rests on a
 * girder below it (above ground), hangs from the ground surface (row -1), or
 * hangs from a girder directly above it (deeper underground).
 */
function girderDirectlySupported(plot: Plot, col: number, row: number): boolean {
  if (row === 0) return true;
  if (row > 0) return hasGirder(plot, col, row - 1);
  // Underground: excavation goes down from the surface.
  return row === -1 || hasGirder(plot, col, row + 1);
}

/**
 * Whether a girder at (col,row) is validly supported: directly, or (above
 * ground only) as a single 1-tile overhang resting on a directly-supported
 * same-row neighbor. Requiring the neighbor to be *directly* supported caps
 * overhangs at one tile — you can't cantilever off another cantilever.
 */
export function girderSupported(plot: Plot, col: number, row: number): boolean {
  if (girderDirectlySupported(plot, col, row)) return true;
  if (row <= 0) return false; // no overhangs at the ground or underground
  return (
    (hasGirder(plot, col - 1, row) && girderDirectlySupported(plot, col - 1, row)) ||
    (hasGirder(plot, col + 1, row) && girderDirectlySupported(plot, col + 1, row))
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
