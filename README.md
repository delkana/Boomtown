# Boomtown

A browser-based tower-building sim in the vein of **SimTower** / **Project Highrise**.
Buy a plot, raise a highrise floor by floor — lobbies, offices, apartments,
elevators — and manage tenants, income, and upkeep.

This is the **single-player MVP**, but it is deliberately architected so a
**multiplayer shared city** can bolt on later: many players each own plots along
a horizontal strip, build multiple buildings, and pan left/right to see one
another's towers. See [Multiplayer boundary](#multiplayer-boundary).

---

## Running it

```bash
npm install
npm run dev      # launches Vite dev server (opens http://localhost:5173)
```

Other scripts:

```bash
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build
npm run typecheck  # tsc --noEmit
```

### How to play

- **Pick a tool** from the bottom toolbar (or press `1`–`4`): Lobby, Office,
  Apartment, Elevator.
- **Click a grid cell** on _your plot_ (the highlighted one) to build.
- Rules: build a **Lobby** on the ground floor first. Everything must rest on
  the ground or on top of another unit (no floating). Offices/apartments only
  earn money when a **Lobby** exists _and_ an **Elevator** reaches their floor.
- **Right-click** a unit to sell it (50% refund).
- **Drag** or use **arrow keys** / `A`,`D` to pan across the city. `Esc`
  deselects the current tool.

Money updates every couple of seconds (one economy **tick**). Watch the
occupancy bar fill on serviced revenue floors.

---

## Architecture

The guiding rule: **STATE is separated from RENDERING and INPUT**, so the state
layer can later be lifted onto a server unchanged.

```
                       ┌──────────────────────────────────────┐
                       │            src/game/  (STATE)          │
                       │  pure data + pure functions, no DOM    │
   Commands ──────────►│  reducer.applyCommand(state, cmd)      │
   (player intents)     │  tick.advanceTick(state)              │──► GameState
                       │  types • constants • state factory      │   (serializable)
                       └──────────────────────────────────────┘
                              ▲                       │
                              │ dispatch(cmd)         │ read-only
                              │                       ▼
        ┌─────────────────────┴───────┐     ┌───────────────────────────┐
        │      src/input/ (INPUT)      │     │   src/render/ (RENDERING)  │
        │  pointer/keys → Commands     │     │  Camera + Renderer          │
        │  + camera pan (view-only)    │     │  GameState → canvas pixels  │
        └──────────────────────────────┘     └───────────────────────────┘
        ┌──────────────────────────────┐     ┌───────────────────────────┐
        │        src/ui/ (HUD)          │     │    src/engine/ (LOOP)      │
        │  DOM toolbar/stats → selects  │     │  fixed-timestep tick +      │
        │  read-only view of state      │     │  per-frame render           │
        └──────────────────────────────┘     └───────────────────────────┘
```

### Directory map

| Path                 | Layer   | Responsibility                                                                 |
| -------------------- | ------- | ------------------------------------------------------------------------------ |
| `src/game/types.ts`  | STATE   | Serializable domain types (`GameState`, `Plot`, `Unit`, `Player`).             |
| `src/game/constants.ts` | STATE | Shared, deterministic tuning: grid dims, costs, income, tick rate.           |
| `src/game/state.ts`  | STATE   | `createInitialState`, plus `serialize` / `deserialize` (snapshot transport).   |
| `src/game/commands.ts` | STATE | `Command` union — **the network boundary** (player intents).                  |
| `src/game/reducer.ts`| STATE   | `applyCommand` — pure, fully validated state transitions.                      |
| `src/game/tick.ts`   | STATE   | `advanceTick` — pure economy step (occupancy, income, upkeep).                 |
| `src/engine/game.ts` | wiring  | Owns state; exposes `dispatch` + `tick`. Becomes the networked shell later.    |
| `src/engine/loop.ts` | LOOP    | Fixed-timestep simulation clock decoupled from render frames.                  |
| `src/render/camera.ts` | RENDER | World⇄screen transforms; screen→cell picking. Shared by render + input.       |
| `src/render/renderer.ts` | RENDER | Draws state to canvas. Read-only, no game logic.                            |
| `src/input/input.ts` | INPUT   | Pointer/keyboard → `Command`s and camera panning. Read-only on state.          |
| `src/ui/hud.ts`      | INPUT/UI| DOM toolbar + stats. Read-only on state; emits tool selections.                |
| `src/main.ts`        | wiring  | Composition root — the only file that knows about all layers.                  |

### Key invariants

1. **State changes only two ways:** a `Command` through `applyCommand`, or the
   periodic `advanceTick`. Nothing else mutates `GameState`.
2. **The STATE layer is pure and DOM-free** — no `window`, `Date.now()`,
   `Math.random()` in a way that would desync a server, no canvas. It's just
   data and functions, so it runs identically on a server.
3. **Render and input only read state and produce commands.** They can be
   swapped, duplicated (multiple viewports), or removed without touching logic.
4. **The reducer is the authority.** The UI pre-checks legality (to grey out /
   colour hover ghosts), but the reducer re-validates everything and never
   trusts the caller — essential once clients are untrusted.

---

## Multiplayer boundary

The seam is already cut. Today:

```
Input → game.dispatch(cmd) → applyCommand(localState) → renderers re-read state
Loop  → game.tick()        → advanceTick(localState)
```

To go multiplayer, only `src/engine/game.ts` changes; **the game logic, input,
render, and HUD stay as-is**:

```
CLIENT                                   SERVER (authoritative)
------                                   ----------------------
Input → game.dispatch(cmd)
      → socket.send(cmd)      ───────►   validate + applyCommand(worldState)
                                         advanceTick(worldState) on a fixed clock
apply(snapshot) ◄─────────── broadcast   serialize(worldState)   (or deltas)
renderers re-read state
```

Concretely, the future server would:

- `import { applyCommand } from "game/reducer"` and `advanceTick` from
  `game/tick` — **the same files this client uses**.
- Hold the full `GameState` with **many plots owned by many players**. The city
  strip and stubbed neighbor plots (`ownerId: null`) in `state.ts` already model
  this — claiming a plot is just a future `CLAIM_PLOT` command that sets
  `ownerId`.
- Push `serialize(state)` snapshots (or per-plot deltas) to clients; each client
  calls `deserialize` and renders. `GameState` is already plain JSON.
- Scope commands per connection: the server derives `playerId` from the socket
  rather than trusting the client-supplied `playerId` field, and the reducer's
  ownership checks (`plot.ownerId !== playerId`) do the rest.

Client-side prediction, delta compression, and interest management (only stream
nearby plots as you pan) are natural follow-ups but need **no change to the
domain layer** — that's the point of the split.

### What's stubbed for the city

- Neighbor plots exist on both sides of the player (`NEIGHBOR_PLOTS_EACH_SIDE`)
  with `ownerId: null` and flavor owner names. They render as static silhouette
  buildings — placeholders for other players' real towers.
- The camera already pans across the whole strip and culls off-screen plots, so
  a wider, server-populated city drops in without view changes.

---

## Tech

- **TypeScript** (strict) + **HTML5 Canvas**, no game framework.
- **Vite** for dev server and build.
- Placeholder art is colored rectangles + simple window sprites; the emphasis is
  gameplay loop and architecture, not polish.
