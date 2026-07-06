import fs from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * Durable key/value storage for the server's two state blobs ("games" and
 * "accounts"), each a serialized JSON string. Backed by Postgres in production
 * (reliable, survives restarts) and by the local filesystem for offline dev.
 *
 * The whole game directory + account store are small, so storing each as one
 * row/file is plenty — no schema churn as the state shape evolves.
 */
export interface Storage {
  load(key: string): Promise<string | null>;
  save(key: string, value: string): Promise<void>;
  describe(): string;
}

/** Local-dev storage: one JSON file per key under a data directory. */
class FileStorage implements Storage {
  constructor(private dir: string) {}
  private file(key: string): string {
    return path.join(this.dir, `${key}.json`);
  }
  async load(key: string): Promise<string | null> {
    try {
      return fs.readFileSync(this.file(key), "utf8");
    } catch {
      return null; // absent or unreadable — treat as empty
    }
  }
  async save(key: string, value: string): Promise<void> {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file(key), value);
  }
  describe(): string {
    return `files at ${this.dir}`;
  }
}

/** Production storage: a single `boomtown_state (k, v)` table in Postgres. */
class PgStorage implements Storage {
  private pool: pg.Pool;
  private ready: Promise<void>;
  constructor(connectionString: string) {
    // Railway's internal DATABASE_URL talks over the private network (no SSL);
    // a public URL would need SSL, so only enable it when the host looks public.
    const ssl = /\bsslmode=require\b/.test(connectionString) ? { rejectUnauthorized: false } : undefined;
    this.pool = new pg.Pool({ connectionString, ssl });
    this.ready = this.init();
  }
  /** Create the table, retrying so a not-yet-ready private DNS/DB doesn't crash boot. */
  private async init(): Promise<void> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        await this.pool.query(
          "CREATE TABLE IF NOT EXISTS boomtown_state (k text PRIMARY KEY, v text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())",
        );
        return;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, Math.min(500 * attempt, 3000)));
      }
    }
    throw lastErr;
  }
  async load(key: string): Promise<string | null> {
    await this.ready;
    const r = await this.pool.query<{ v: string }>("SELECT v FROM boomtown_state WHERE k = $1", [key]);
    return r.rows[0]?.v ?? null;
  }
  async save(key: string, value: string): Promise<void> {
    await this.ready;
    await this.pool.query(
      `INSERT INTO boomtown_state (k, v, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now()`,
      [key, value],
    );
  }
  describe(): string {
    return "Postgres (boomtown_state)";
  }
}

/**
 * Pick a storage backend: Postgres when DATABASE_URL is set (production),
 * otherwise the local filesystem under `dataDir` (offline dev + tests).
 */
export function createStorage(opts: { databaseUrl?: string; dataDir: string }): Storage {
  const url = opts.databaseUrl?.trim();
  return url ? new PgStorage(url) : new FileStorage(opts.dataDir);
}
