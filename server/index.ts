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

const hasSaved = fs.existsSync(DATA_FILE);
const handle = await startServer({ port: PORT, seed: !hasSaved });

if (hasSaved) {
  try {
    handle.directory.load(fs.readFileSync(DATA_FILE, "utf8"));
    console.log("Restored saved cities from", DATA_FILE);
  } catch (e) {
    console.warn("Could not load saved games; seeding fresh:", e);
  }
}

// Debounced persistence: coalesce bursts of changes into one write.
let timer: ReturnType<typeof setTimeout> | null = null;
handle.directory.onChange(() => {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, handle.directory.serialize());
    } catch (e) {
      console.warn("Persist failed:", e);
    }
  }, 500);
});

console.log(`Boomtown server listening on ws://localhost:${handle.port}`);
