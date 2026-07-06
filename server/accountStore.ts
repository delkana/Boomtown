import crypto from "node:crypto";
import { PLAYER_COLORS } from "../src/game/constants";
import type { AuthResult, Membership, Profile } from "../src/net/protocol";

/**
 * Server-side user accounts. A user has a username + scrypt-hashed password, a
 * set of session tokens that keep them signed in across refreshes/redeploys,
 * and the list of games they belong to (each with its reconnect token) so those
 * follow the account to any device. Purely a server concern — the client only
 * ever holds a session token, never a password hash.
 *
 * Passwords are salted + hashed with scrypt and compared in constant time. This
 * is a hobby-scale auth: no email, no rate-limiting, no password reset. Over
 * WSS the password is encrypted in transit; it is never stored in the clear.
 */

const SALT_BYTES = 16;
const SESSION_BYTES = 24;
const KEYLEN = 32;

interface Account {
  username: string; // as displayed (canonical key is lowercase)
  displayName: string;
  color: string; // preferred color id
  salt: string; // hex
  hash: string; // hex scrypt(password, salt)
  createdAt: number;
  memberships: Map<string, Membership>; // gameId -> membership
}

const err = (error: string): AuthResult => ({ ok: false, error });

export class AccountStore {
  private users = new Map<string, Account>(); // key: lowercase username
  private sessions = new Map<string, string>(); // sessionToken -> username key
  private onChangeCb: (() => void) | null = null;

  onChange(cb: () => void): void {
    this.onChangeCb = cb;
  }
  private changed(): void {
    this.onChangeCb?.();
  }

  register(username: string, password: string, displayName: string, color: string): AuthResult {
    const uname = (username ?? "").trim();
    if (uname.length < 3 || uname.length > 20) return err("Username must be 3–20 characters");
    if (!/^[a-zA-Z0-9_]+$/.test(uname)) return err("Username: letters, numbers and _ only");
    const key = uname.toLowerCase();
    if (this.users.has(key)) return err("That username is taken");
    if ((password ?? "").length < 6) return err("Password must be at least 6 characters");
    const dName = ((displayName ?? "").trim() || uname).slice(0, 24);
    const col = PLAYER_COLORS.some((c) => c.id === color) ? color : PLAYER_COLORS[0].id;
    const salt = crypto.randomBytes(SALT_BYTES).toString("hex");
    const account: Account = {
      username: uname,
      displayName: dName,
      color: col,
      salt,
      hash: this.hashPw(password, salt),
      createdAt: Date.now(),
      memberships: new Map(),
    };
    this.users.set(key, account);
    return this.newSession(account);
  }

  login(username: string, password: string): AuthResult {
    const key = (username ?? "").trim().toLowerCase();
    const account = this.users.get(key);
    // Hash even when the user is missing so timing doesn't reveal existence.
    const salt = account?.salt ?? "0".repeat(SALT_BYTES * 2);
    const candidate = this.hashPw(password ?? "", salt);
    if (!account || !this.safeEqual(candidate, account.hash)) return err("Wrong username or password");
    return this.newSession(account);
  }

  /** Resume a session (no password) — keeps the user signed in across reloads. */
  resume(sessionToken: string): AuthResult {
    const account = this.accountForSession(sessionToken);
    if (!account) return err("Your session expired — please sign in again");
    return { ok: true, sessionToken, profile: this.profile(account), memberships: [...account.memberships.values()] };
  }

  logout(sessionToken: string): void {
    if (this.sessions.delete(sessionToken)) this.changed();
  }

  /** The (canonical) username owning an active session, or null. */
  userForSession(sessionToken: string): string | null {
    return this.sessions.get(sessionToken) ?? null;
  }

  /** Record (or update) a game the user belongs to. */
  recordMembership(usernameKey: string, m: Membership): void {
    const account = this.users.get(usernameKey.toLowerCase());
    if (!account) return;
    account.memberships.set(m.gameId, m);
    this.changed();
  }

  /** Drop memberships whose game no longer exists (keeps "your games" clean). */
  pruneMemberships(gameExists: (gameId: string) => boolean): void {
    let dirty = false;
    for (const account of this.users.values()) {
      for (const gameId of [...account.memberships.keys()]) {
        if (!gameExists(gameId)) {
          account.memberships.delete(gameId);
          dirty = true;
        }
      }
    }
    if (dirty) this.changed();
  }

  private newSession(account: Account): AuthResult {
    const token = crypto.randomBytes(SESSION_BYTES).toString("hex");
    this.sessions.set(token, account.username.toLowerCase());
    this.changed();
    return { ok: true, sessionToken: token, profile: this.profile(account), memberships: [...account.memberships.values()] };
  }

  private accountForSession(sessionToken: string): Account | undefined {
    const key = this.sessions.get(sessionToken ?? "");
    return key ? this.users.get(key) : undefined;
  }

  private profile(a: Account): Profile {
    return { username: a.username, displayName: a.displayName, color: a.color };
  }

  private hashPw(password: string, salt: string): string {
    return crypto.scryptSync(password, salt, KEYLEN).toString("hex");
  }

  private safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
  }

  // --- persistence -----------------------------------------------------------

  serialize(): string {
    return JSON.stringify({
      users: [...this.users.values()].map((a) => ({
        username: a.username,
        displayName: a.displayName,
        color: a.color,
        salt: a.salt,
        hash: a.hash,
        createdAt: a.createdAt,
        memberships: [...a.memberships.values()],
      })),
      sessions: [...this.sessions.entries()],
    });
  }

  load(json: string): void {
    try {
      const data = JSON.parse(json) as {
        users?: (Omit<Account, "memberships"> & { memberships?: Membership[] })[];
        sessions?: [string, string][];
      };
      this.users.clear();
      this.sessions.clear();
      for (const u of data.users ?? []) {
        this.users.set(u.username.toLowerCase(), {
          ...u,
          memberships: new Map((u.memberships ?? []).map((m) => [m.gameId, m])),
        });
      }
      for (const [token, key] of data.sessions ?? []) this.sessions.set(token, key);
    } catch {
      /* corrupt save — start empty */
    }
  }
}
