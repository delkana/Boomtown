import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./wsServer";

/**
 * Process entry point for the authoritative server.
 *
 *   npm run server            # ws://localhost:8787
 *   PORT=9000 npm run server  # custom port
 *
 * Persists the whole game directory (including reconnect tokens) to
 * server/data/games.json so cities survive restarts. On first boot (no save
 * file) it seeds the demo cities.
 */
const PORT = Number(process.env.PORT) || 8787;
const dirName = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(dirName, "data");
const DATA_FILE = path.join(DATA_DIR, "games.json");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");
const STATIC_DIR = path.join(dirName, "..", "dist"); // the built web app

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

if (fs.existsSync(DATA_FILE)) {
  try {
    handle.directory.load(fs.readFileSync(DATA_FILE, "utf8"));
    console.log("Restored saved player games from", DATA_FILE);
  } catch (e) {
    console.warn("Could not load saved games:", e);
  }
}
if (fs.existsSync(ACCOUNTS_FILE)) {
  try {
    handle.accounts.load(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
    // Forget memberships whose game no longer exists so "your games" stays clean.
    handle.accounts.pruneMemberships((gameId) => handle.directory.summaries().some((g) => g.id === gameId));
    console.log("Restored accounts from", ACCOUNTS_FILE);
  } catch (e) {
    console.warn("Could not load accounts:", e);
  }
}

// Debounced persistence: coalesce bursts of changes into one write per file.
const persist = (file: string, data: () => string): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(file, data());
      } catch (e) {
        console.warn("Persist failed:", e);
      }
    }, 500);
  };
};
handle.directory.onChange(persist(DATA_FILE, () => handle.directory.serialize()));
handle.accounts.onChange(persist(ACCOUNTS_FILE, () => handle.accounts.serialize()));

console.log(`Boomtown listening on port ${handle.port} (web + WebSocket)`);
