# Boomtown

A browser-based tower-building sim in the vein of **SimTower** / **Project
Highrise**, built as a **shared city**: many players each claim plots along a
horizontal strip, raise highrises floor by floor (lobbies, offices, apartments,
elevators), and pan left/right to see one another's towers.

The multiplayer seam is **real, not hypothetical** — the game already runs
against an authoritative *server*, it's just an in-process **fake server**
(`src/net/localServer.ts`) for now. Replacing it with a networked client is the
only change needed to go online; see [Multiplayer](#multiplayer).

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

### Playing

**1. Lobby.** On load you get a lobby:

- **Create a City** — set the city name (this names the game), number of
  properties (plots), max players (≤ 20), your name, and pick a color (each
  color can only be used by one player in a game). Optionally password-protect it.
- **Join a City** — the list shows existing cities (a few demo cities are
  pre-seeded). Joining asks for your name and a color (colors already taken in
  that game are disabled), plus the password if the city has one. Cities you've
  already joined show **Enter** so you can rejoin without re-picking.

**2. In-game.**

- **Claim** (`C` or the Claim tool): click an **Available** plot to buy it.
- **Build** (`1`–`4`): Lobby, Office, Apartment, Elevator — click a grid cell on
  a plot **you own**. Build a **Lobby** on the ground floor first; everything
  must rest on the ground or on another unit (no floating). Offices/apartments
  only earn money when a Lobby exists **and** an Elevator reaches their floor.
- **Right-click** a unit to sell it (50% refund).
- **Drag** or use **arrow keys** / `A`,`D` to pan the city. `Esc` deselects.
  **Leave** (top bar) returns to the lobby.

Money updates each economy **tick** (~2s), driven by the server.

---

## Architecture

Two rules drive the layout:

1. **STATE is separated from RENDER and INPUT.**
2. **STATE is owned by a server**; the client sends *commands* and renders
   *snapshots*. Today the "server" is in-process, but the boundary is genuine.

```
  CLIENT                                             SERVER (authoritative)
  ──────                                             ──────────────────────
  src/input     ──dispatch(cmd)──►  GameConnection ──►  AuthoritativeGame
  src/ui (HUD)                        (src/net)          (src/net) owns GameState
      ▲                                   │              · applyCommand(cmd)   ← src/game/reducer
      │ read snapshot                     │              · advanceTick()  (2s) ← src/game/tick
  src/render   ◄──onSnapshot(state)───────┘◄─broadcast─  serialize(state)      ← src/game/state
  src/engine  (per-frame render loop)                    (one per game)

  LOBBY:  src/ui/lobby ──► GameServer (createGame / joinGame / listGames) ──► GameConnection
```

- **`src/game/` (STATE)** — pure, DOM-free, serializable domain. Runs unchanged
  on client or server. Notably it has **no `localPlayerId`**: which player a
  client is, is per-connection info, not shared world state.
- **`src/net/` (BOUNDARY)** — the transport seam. `GameServer` +
  `GameConnection` are the interfaces the rest of the app depends on;
  `LocalServer` / `LocalConnection` are the in-process implementations.
- **`src/render`, `src/input`, `src/ui`** — read state through the connection,
  produce commands. Never mutate state.

### Directory map

| Path                       | Layer    | Responsibility                                                                       |
| -------------------------- | -------- | ------------------------------------------------------------------------------------ |
| `src/game/types.ts`        | STATE    | Serializable domain types (`GameState`, `Plot`, `Unit`, `Player`, `GameConfig`).     |
| `src/game/constants.ts`    | STATE    | Deterministic tuning: grid, costs, income, tick rate, player color palette.          |
| `src/game/state.ts`        | STATE    | `createGameState` + `serialize` / `deserialize` (the snapshot format).               |
| `src/game/commands.ts`     | STATE    | `Command` union (`CLAIM_PLOT`, `PLACE_UNIT`, `SELL_UNIT`) — **the wire protocol for intents**. |
| `src/game/reducer.ts`      | STATE    | `applyCommand` — pure, fully validated, authoritative state transitions.             |
| `src/game/tick.ts`         | STATE    | `advanceTick` — pure economy step (occupancy, income, upkeep).                       |
| `src/net/protocol.ts`      | BOUNDARY | Wire DTOs: `GameSummary`, `CreateGameConfig`, `JoinRequest`, `PlayerSession`.         |
| `src/net/authoritativeGame.ts` | SERVER | Owns one game's `GameState`; applies commands, runs the tick clock, broadcasts snapshots. |
| `src/net/connection.ts`    | BOUNDARY | `GameConnection` interface + `LocalConnection` (client's handle on a game).           |
| `src/net/localServer.ts`   | SERVER   | `GameServer` interface + `LocalServer`: lobby, validation, demo-city seeding.         |
| `src/render/camera.ts`     | RENDER   | World⇄screen transforms; screen→cell picking. Shared by render + input.              |
| `src/render/renderer.ts`   | RENDER   | Draws the whole city (all owners' plots) to canvas. Read-only.                       |
| `src/input/input.ts`       | INPUT    | Pointer/keyboard → commands (via connection) + camera panning.                       |
| `src/engine/loop.ts`       | LOOP     | Per-frame render loop (the tick is server-side now).                                  |
| `src/ui/hud.ts`            | UI       | In-game DOM: header, player chip, stats, build toolbar. Read-only on state.          |
| `src/ui/lobby.ts`          | UI       | Lobby screen: create / browse / join, color picker, password prompt.                 |
| `src/main.ts`              | wiring   | Composition root: lobby → in-game, wires a connection to render/input/HUD.           |

### Key invariants

1. **State changes only two ways:** a `Command` through `applyCommand`, or the
   server's `advanceTick`. Nothing else mutates `GameState`.
2. **The STATE layer is pure and DOM-free**, so it runs identically on a server.
3. **Render/input/HUD only read state (via `GameConnection`) and emit commands.**
4. **The reducer is the authority.** The UI greys out illegal actions for feel,
   but every command is re-validated server-side (ownership, funds, placement) —
   clients are never trusted. Same for the lobby: color/password/capacity rules
   are enforced in `LocalServer`, not just the form.
5. **The client renders snapshots.** `LocalConnection` deserializes a fresh
   snapshot on every broadcast — the exact path a networked client takes — so the
   snapshot format is dogfooded continuously.

---

## Multiplayer

The boundary is implemented; only the transport is local. To go online you
implement the two interfaces against a socket and change **nothing else**:

```
                         Today (local)                Networked (later)
GameServer     LocalServer (in-process Map)   →  RPC client over WebSocket
GameConnection LocalConnection (direct calls) →  socket send + snapshot stream
AuthoritativeGame  runs in the browser        →  runs on the server (same class)
```

Because `AuthoritativeGame` already `import`s `applyCommand`, `advanceTick`, and
`serialize` from `src/game/`, the real server reuses those files verbatim. The
client's render/input/HUD only ever touch `GameConnection`, so they don't move.

What a real server changes (all outside the domain layer):

- **Identity from the connection.** Commands carry `playerId`; a real server
  ignores the client-supplied value and derives it from the authenticated socket.
  The reducer's ownership checks (`plot.ownerId !== playerId`) already enforce the
  rest.
- **Continuous ticking.** `AuthoritativeGame` currently ticks only while a client
  is subscribed (no point simulating an unobserved local city); a real server
  ticks always.
- **Async acks.** `LocalConnection.dispatch` learns a command's rejection reason
  synchronously; over a socket that becomes an ack/error message. The `lastError`
  hook is already the place it surfaces.

Natural follow-ups that need **no domain change**: delta snapshots instead of
full state, client-side prediction, and interest management (only stream plots
near the viewport as you pan).

### Demo cities

`LocalServer` seeds a couple of cities (one password-protected) with existing
owners and pre-built towers, so the browse/join flow — taken colors, password
prompts, populated skyline — works out of the box.

---

## Tech

- **TypeScript** (strict) + **HTML5 Canvas**, no game framework.
- **Vite** for dev server and build.
- Placeholder art is colored rectangles; the owner-color band on each unit shows
  who owns it. Emphasis is on the gameplay loop and architecture, not polish.
