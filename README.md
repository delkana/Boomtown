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
npm test           # vitest: domain unit tests + a real-WebSocket multiplayer test
npm run server     # start the authoritative WebSocket server (ws://localhost:8787)
```

### Playing online (real multiplayer)

By default the game runs **fully offline** against an in-browser server. To play
a genuinely shared, networked city:

```bash
npm run server          # terminal 1 — authoritative server on ws://localhost:8787
npm run dev             # terminal 2 — the client
```

Then open the client at **`http://localhost:5173/?server=ws://localhost:8787`**
(or set `localStorage["boomtown.serverUrl"]`). The lobby header shows
**● Online**. Open that URL in two browsers/tabs, join the same city, and you'll
see each other claim plots and raise towers in real time. The server persists
every city to `server/data/games.json`, so it survives restarts.

### Playing

**1. Lobby.** On load you get a lobby:

- **Create a City** — pick a **city archetype** (Pacifica, Japan, USSR, Gulf
  Emirates, Straits Union, African Union, … 16 in all, each with its own flag, background, and
  themed property names), then name the city (or 🎲 roll a random name drawn from
  that region's real skyscraper-cities and fictional ones). Set the number of
  properties (plots), max players (≤ 20), your name, and pick a color (each color
  can only be used by one player in a game). Optionally password-protect it.
- **Join a City** — the list shows existing cities (a few demo cities are
  pre-seeded). Joining asks for your name and a color (colors already taken in
  that game are disabled), plus the password if the city has one. Cities you've
  already joined show **Enter** so you can rejoin without re-picking.

**2. In-game.**

- **Claim** (`C` or the Claim tool): click an **Available** plot to buy it. Plots
  vary in width (7–17 tiles); price scales with width ($4k–$20k) and each extra
  plot you own multiplies the cost (2nd ×2, 3rd ×3, …). Towers can rise 50 floors.
- Every city also has a couple of **feature plots** — a river crossing, a park,
  or an elevated highway (~6 tiles wide) — that can't be claimed or built on.
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
  `GameConnection` are the interfaces the rest of the app depends on. There are
  **two interchangeable implementations**: `LocalServer`/`LocalConnection`
  (in-process) and `RemoteServer`/`RemoteConnection` (WebSocket). Both drive the
  same `GameDirectory` + `AuthoritativeGame`.
- **`src/render`, `src/input`, `src/ui`** — read state through the connection,
  produce commands. Never mutate state.

### Directory map

| Path                       | Layer    | Responsibility                                                                       |
| -------------------------- | -------- | ------------------------------------------------------------------------------------ |
| `src/game/types.ts`        | STATE    | Serializable domain types (`GameState`, `Plot`, `Unit`, `Player`, `GameConfig`).     |
| `src/game/constants.ts`    | STATE    | Deterministic tuning: grid, costs, income, tick rate, player color palette.          |
| `src/game/archetypes.ts`   | STATE    | 16 city archetypes: blurbs, real+fictional city-name pools, themed property names.   |
| `src/game/state.ts`        | STATE    | `createGameState` (variable plot widths + feature plots) + `serialize`/`deserialize`. |
| `src/game/economy.ts`      | STATE    | Land pricing: width-based base cost × ownership multiplier. Shared by reducer + UI.   |
| `src/game/features.ts`     | STATE    | Non-buildable city features (river/park/highway): kinds, names, placement helpers.   |
| `src/game/hash.ts`         | STATE    | Deterministic string hash used for reproducible city generation.                     |
| `src/game/commands.ts`     | STATE    | `Command` union (`CLAIM_PLOT`, `PLACE_UNIT`, `SELL_UNIT`) — **the wire protocol for intents**. |
| `src/game/reducer.ts`      | STATE    | `applyCommand` — pure, fully validated, authoritative state transitions.             |
| `src/game/tick.ts`         | STATE    | `advanceTick` — pure economy step (occupancy, income, upkeep).                       |
| `src/net/protocol.ts`      | BOUNDARY | Wire DTOs + WebSocket message unions (`ClientMsg`, `ServerMsg`).                      |
| `src/net/gameDirectory.ts` | SERVER   | Transport-agnostic core: game registry, all lobby validation, reconnect tokens, (de)serialization. Used by both servers. |
| `src/net/authoritativeGame.ts` | SERVER | Owns one game's `GameState`; applies commands, runs the tick clock, broadcasts snapshots. |
| `src/net/connection.ts`    | BOUNDARY | `GameConnection` interface + `LocalConnection` (in-process handle).                   |
| `src/net/localServer.ts`   | SERVER   | `GameServer` interface + `LocalServer` (offline; localStorage persistence).           |
| `src/net/remoteServer.ts`  | CLIENT   | `RemoteServer` + `RemoteConnection` — the WebSocket transport (browser side).         |
| `server/wsServer.ts`       | SERVER   | Node WebSocket server: routes the wire protocol to a `GameDirectory`.                 |
| `server/index.ts`          | SERVER   | Process entry: port config + JSON file persistence of all cities.                    |
| `test/domain.test.ts`      | TEST     | Vitest suite over the pure simulation (reducer, tick, claim, archetypes, serialize). |
| `test/multiplayer.test.ts` | TEST     | Two real `ws` clients: cross-player sync + server-authoritative identity.             |
| `src/render/camera.ts`     | RENDER   | World⇄screen transforms; screen→cell picking. Shared by render + input.              |
| `src/render/renderer.ts`   | RENDER   | Draws the whole city (all owners' plots) to canvas. Read-only.                       |
| `src/input/input.ts`       | INPUT    | Pointer/keyboard → commands (via connection) + camera panning.                       |
| `src/engine/loop.ts`       | LOOP     | Per-frame render loop (the tick is server-side now).                                  |
| `src/ui/hud.ts`            | UI       | In-game DOM: header, player chip, stats, build toolbar. Read-only on state.          |
| `src/ui/lobby.ts`          | UI       | Lobby screen: archetype picker, create / browse / join, color picker, password prompt. |
| `src/ui/flags.ts`          | UI       | Stylized SVG national flag per archetype (lobby, game list, in-game topbar).          |
| `src/main.ts`              | wiring   | Composition root: lobby → in-game, wires a connection to render/input/HUD.           |

### Key invariants

1. **State changes only two ways:** a `Command` through `applyCommand`, or the
   server's `advanceTick`. Nothing else mutates `GameState`.
2. **The STATE layer is pure and DOM-free**, so it runs identically on a server.
3. **Render/input/HUD only read state (via `GameConnection`) and emit commands.**
4. **The reducer is the authority.** The UI greys out illegal actions for feel,
   but every command is re-validated server-side (ownership, funds, placement) —
   clients are never trusted. Same for the lobby: color/password/capacity rules
   are enforced in `GameDirectory` (shared by both servers), not just the form.
5. **The client renders snapshots.** `LocalConnection` deserializes a fresh
   snapshot on every broadcast — the exact path a networked client takes — so the
   snapshot format is dogfooded continuously.

---

## Multiplayer

Multiplayer is **implemented**, not hypothetical. The same `GameServer` /
`GameConnection` interfaces have two implementations, chosen at startup:

```
                    Offline (default)              Online (?server=ws://…)
GameServer      LocalServer                    RemoteServer  ──┐  WebSocket
GameConnection  LocalConnection                RemoteConnection │
                     │                                          ▼
                GameDirectory  ◄──── identical ────►  server/wsServer → GameDirectory
                AuthoritativeGame                     AuthoritativeGame (Node)
```

The authoritative logic lives in **one place** — `GameDirectory` (lobby rules,
tokens) and `AuthoritativeGame` (commands, tick, snapshots) — and both the
offline and online paths run it, so behavior can't drift. `AuthoritativeGame`
imports `applyCommand` / `advanceTick` / `serialize` straight from `src/game/`,
and the Node server reuses those files verbatim.

What the networked path adds — all **outside** the render/input/UI layers:

- **Server-authoritative identity.** Commands carry a `playerId`, but the server
  overwrites it with the id it assigned to that socket. A client cannot act as
  another player by spoofing the field (covered by `test/multiplayer.test.ts`).
- **Async lobby.** `createGame` / `joinGame` / `reconnect` return Promises;
  `listGames()` stays sync and reads a cache the server keeps fresh via directory
  pushes. `ready()` resolves once connected.
- **Reconnect tokens.** Create/join issue a secret token (kept in a server-side
  side map, never in broadcast `GameState`). The client stores it in
  `localStorage` and reuses it to rejoin after a refresh — the lobby shows
  **Enter** instead of Join.

### Persistence

- **Server:** `server/index.ts` writes the whole directory (cities, towers,
  tokens) to `server/data/games.json` and restores it on boot.
- **Client:** offline `LocalServer` persists its directory to `localStorage`, and
  joined-session tokens are persisted so rejoin survives a refresh in both modes.

Natural follow-ups that still need **no domain change**: delta snapshots instead
of full-state broadcasts, client-side prediction, and interest management (only
stream plots near the viewport as you pan).

### Demo cities

`GameDirectory` seeds a few cities (one password-protected) with existing owners
and pre-built towers, so the browse/join flow — taken colors, password prompts,
populated skyline — works out of the box, offline or online.

---

## Tech

- **TypeScript** (strict) + **HTML5 Canvas**, no game framework.
- **Vite** for dev server and build.
- Placeholder art is colored rectangles; the owner-color band on each unit shows
  who owns it. Emphasis is on the gameplay loop and architecture, not polish.
