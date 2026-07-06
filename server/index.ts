import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./wsServer";
import { createStorage } from "./storage";

/**
 * Process entry point for the authoritative server.
 *
 *   npm run server            # ws://localhost:8787
 *   PORT=9000 npm run server  # custom port
 *
 * Persists the whole game directory (including reconnect tokens) and the account
 * store to durable storage so cities + logins survive restarts: Postgres in
 * production (DATABASE_URL set), or local JSON files for offline dev. On first
 * boot (nothing saved) it seeds the demo cities.
 */
const PORT = Number(process.env.PORT) || 8787;
const dirName = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(dirName, "data"); // local-dev file fallback
const STATIC_DIR = path.join(dirName, "..", "dist"); // the built web app

// Postgres in production, local files otherwise. Two blobs: "games" + "accounts".
const storage = createStorage({ databaseUrl: process.env.DATABASE_URL, dataDir: DATA_DIR });
console.log(`[storage] backend: ${storage.describe()}`);

// Admin accounts: whoever holds these usernames gets the admin console. Defaults
// to "delkana"; override with BOOMTOWN_ADMINS="name1,name2" in the environment.
const ADMINS = (process.env.BOOMTOWN_ADMINS ?? "delkana")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Always seed the built-in demo cities fresh, then merge any saved player games
// on top (so edits to the demo cities always show, and creations persist).
// The same server also serves the built web app when it's present.
const handle = await startServer({
  port: PORT,
  seed: true,
  staticDir: fs.existsSync(STATIC_DIR) ? STATIC_DIR : undefined,
  admins: ADMINS,
});

try {
  const gamesJson = await storage.load("games");
  if (gamesJson) {
    handle.directory.load(gamesJson);
    console.log("[storage] restored saved player games");
  } else {
    console.log("[storage] no saved games — starting fresh");
  }
} catch (e) {
  console.warn("[storage] could not load saved games:", e);
}
try {
  const accountsJson = await storage.load("accounts");
  if (accountsJson) {
    handle.accounts.load(accountsJson);
    // Forget memberships whose game no longer exists so "your games" stays clean.
    handle.accounts.pruneMemberships((gameId) => handle.directory.summaries().some((g) => g.id === gameId));
    console.log("[storage] restored accounts");
  } else {
    console.log("[storage] no saved accounts — starting fresh");
  }
} catch (e) {
  console.warn("[storage] could not load accounts:", e);
}

// Debounced persistence: coalesce bursts of changes into one write per blob, and
// keep an async flush so we can drain pending writes on shutdown.
const persisters: Array<() => Promise<void>> = [];
const persist = (key: string, data: () => string): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let loggedFirst = false;
  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    try {
      await storage.save(key, data());
      if (!loggedFirst) {
        loggedFirst = true;
        console.log("[storage] first write OK:", key);
      }
    } catch (e) {
      console.error("[storage] persist FAILED for", key, e);
    }
  };
  persisters.push(flush);
  return () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, 500);
  };
};
handle.directory.onChange(persist("games", () => handle.directory.serialize()));
handle.accounts.onChange(persist("accounts", () => handle.accounts.serialize()));

// Railway sends SIGTERM before stopping/redeploying. Drain pending writes first
// so the last few seconds of changes aren't lost.
let shuttingDown = false;
const shutdown = async (sig: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[storage] ${sig} — flushing ${persisters.length} pending write(s)`);
  await Promise.allSettled(persisters.map((f) => f()));
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

console.log(`Boomtown listening on port ${handle.port} (web + WebSocket)`);
