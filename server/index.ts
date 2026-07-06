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
// Where persisted state lives. Defaults to server/data for local dev; in
// production set DATA_DIR to the mounted volume path (e.g. /data on Railway) so
// games + accounts survive restarts regardless of where the volume is mounted.
const DATA_DIR = process.env.DATA_DIR || path.join(dirName, "data");
const DATA_FILE = path.join(DATA_DIR, "games.json");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");
const STATIC_DIR = path.join(dirName, "..", "dist"); // the built web app

// --- storage diagnostics: confirm the data dir is the mounted volume and is
// writable, so persistence problems surface in the logs instead of silently. ---
console.log(`[storage] DATA_DIR = ${DATA_DIR}`);
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const contents = fs.readdirSync(DATA_DIR);
  console.log(`[storage] contents at boot: ${contents.length ? contents.join(", ") : "(empty)"}`);
  const probe = path.join(DATA_DIR, ".write-probe");
  fs.writeFileSync(probe, String(Date.now()));
  fs.readFileSync(probe, "utf8");
  fs.rmSync(probe);
  console.log("[storage] write probe OK");
} catch (e) {
  console.error("[storage] DATA_DIR is NOT writable:", e);
}
try {
  const mounts = fs
    .readFileSync("/proc/self/mountinfo", "utf8")
    .split("\n")
    .filter((l) => l.includes("server/data") || / \/data /.test(l));
  console.log(`[storage] volume mount(s): ${mounts.length ? "\n" + mounts.join("\n") : "(NONE — data dir is on the ephemeral container fs, not a volume!)"}`);
} catch {
  /* /proc not available (non-Linux) */
}

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
} else {
  console.log("[storage] no saved games at", DATA_FILE, "— starting fresh");
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
} else {
  console.log("[storage] no saved accounts at", ACCOUNTS_FILE, "— starting fresh");
}

// Debounced persistence: coalesce bursts of changes into one write per file, but
// keep the pending writer so we can flush it synchronously on shutdown.
const writeNow = (file: string, data: () => string): void => {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, data());
  } catch (e) {
    console.error("[storage] persist FAILED for", file, e);
  }
};
const persisters: Array<() => void> = [];
const persist = (file: string, data: () => string): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let loggedFirst = false;
  const flush = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    writeNow(file, data);
    if (!loggedFirst) {
      loggedFirst = true;
      console.log("[storage] first write OK:", file);
    }
  };
  persisters.push(flush);
  return () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, 500);
  };
};
handle.directory.onChange(persist(DATA_FILE, () => handle.directory.serialize()));
handle.accounts.onChange(persist(ACCOUNTS_FILE, () => handle.accounts.serialize()));

// Railway sends SIGTERM before stopping/redeploying the container. Flush any
// pending debounced writes so the last few seconds of changes aren't lost.
let shuttingDown = false;
const shutdown = (sig: string): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[storage] ${sig} — flushing ${persisters.length} pending write(s)`);
  for (const flush of persisters) flush();
  process.exit(0);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

console.log(`Boomtown listening on port ${handle.port} (web + WebSocket)`);
