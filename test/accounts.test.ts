import { describe, it, expect } from "vitest";
import { AccountStore } from "../server/accountStore";

describe("AccountStore", () => {
  it("registers a user and returns a session + profile", () => {
    const s = new AccountStore();
    const r = s.register("Ada_Lovelace", "hunter2!", "Ada", "crimson");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile).toEqual({ username: "Ada_Lovelace", displayName: "Ada", color: "crimson", isAdmin: false });
    expect(r.sessionToken.length).toBeGreaterThan(20);
    expect(r.memberships).toEqual([]);
  });

  it("rejects bad usernames / short passwords / duplicates", () => {
    const s = new AccountStore();
    expect(s.register("ab", "hunter2", "x", "crimson").ok).toBe(false); // too short
    expect(s.register("has space", "hunter2", "x", "crimson").ok).toBe(false); // bad chars
    expect(s.register("goodname", "short", "x", "crimson").ok).toBe(false); // password < 6
    expect(s.register("goodname", "longenough", "x", "crimson").ok).toBe(true);
    expect(s.register("GoodName", "longenough2", "x", "crimson").ok).toBe(false); // dup (case-insensitive)
  });

  it("logs in with the right password only, never storing it in the clear", () => {
    const s = new AccountStore();
    s.register("bob", "correct-horse", "Bob", "azure");
    expect(s.login("bob", "wrong").ok).toBe(false);
    expect(s.login("BOB", "correct-horse").ok).toBe(true); // username case-insensitive
    expect(s.login("nope", "whatever").ok).toBe(false); // unknown user
    // The serialized form must not contain the plaintext password.
    expect(s.serialize()).not.toContain("correct-horse");
  });

  it("resumes a session and forgets it on logout", () => {
    const s = new AccountStore();
    const r = s.register("carol", "password123", "Carol", "jade");
    if (!r.ok) throw new Error("register failed");
    expect(s.resume(r.sessionToken).ok).toBe(true);
    expect(s.resume("bogus").ok).toBe(false);
    s.logout(r.sessionToken);
    expect(s.resume(r.sessionToken).ok).toBe(false);
  });

  it("remembers a user's game memberships and returns them on resume", () => {
    const s = new AccountStore();
    const r = s.register("dave", "password123", "Dave", "gold");
    if (!r.ok) throw new Error("register failed");
    s.recordMembership("dave", { gameId: "g1", playerId: "p2", token: "tok-1", cityName: "Neo-Kyoto" });
    const again = s.resume(r.sessionToken);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.memberships).toEqual([{ gameId: "g1", playerId: "p2", token: "tok-1", cityName: "Neo-Kyoto" }]);
  });

  it("survives a serialize/load round-trip (persistence)", () => {
    const s = new AccountStore();
    s.register("erin", "password123", "Erin", "teal");
    s.recordMembership("erin", { gameId: "g9", playerId: "p1", token: "t9", cityName: "Kosmograd" });
    const json = s.serialize();

    const restored = new AccountStore();
    restored.load(json);
    const login = restored.login("erin", "password123");
    expect(login.ok).toBe(true);
    if (login.ok) expect(login.memberships.map((m) => m.gameId)).toContain("g9");
    expect(restored.login("erin", "wrong").ok).toBe(false);
  });

  it("prunes memberships for games that no longer exist", () => {
    const s = new AccountStore();
    const r = s.register("frank", "password123", "Frank", "coral");
    if (!r.ok) throw new Error("register failed");
    s.recordMembership("frank", { gameId: "gone", playerId: "p1", token: "t", cityName: "X" });
    s.recordMembership("frank", { gameId: "kept", playerId: "p1", token: "t", cityName: "Y" });
    s.pruneMemberships((id) => id === "kept");
    const login = s.login("frank", "password123");
    expect(login.ok).toBe(true);
    if (login.ok) expect(login.memberships.map((m) => m.gameId)).toEqual(["kept"]);
  });
});

describe("AccountStore — admin & bans", () => {
  it("marks allowlisted usernames as admin (case-insensitive)", () => {
    const s = new AccountStore(["Delkana"]);
    const admin = s.register("Delkana", "password123", "Del", "crimson");
    const normal = s.register("randouser", "password123", "Rando", "azure");
    expect(admin.ok && admin.profile.isAdmin).toBe(true);
    expect(normal.ok && !!normal.profile.isAdmin).toBe(false);
    expect(s.isAdmin("DELKANA")).toBe(true);
    expect(s.isAdmin("randouser")).toBe(false);
  });

  it("authorizes admin actions only for a non-banned admin session", () => {
    const s = new AccountStore(["delkana"]);
    const admin = s.register("delkana", "password123", "Del", "crimson");
    const user = s.register("bob", "password123", "Bob", "azure");
    if (!admin.ok || !user.ok) throw new Error("setup failed");
    expect(s.isAdminSession(admin.sessionToken)).toBe(true);
    expect(s.isAdminSession(user.sessionToken)).toBe(false);
    expect(s.isAdminSession("garbage")).toBe(false);
  });

  it("lists accounts without exposing password material", () => {
    const s = new AccountStore(["delkana"]);
    s.register("delkana", "secretpw123", "Del", "crimson");
    const r = s.register("bob", "hunter2!!", "Bob", "azure");
    if (!r.ok) throw new Error("setup failed");
    s.recordMembership("bob", { gameId: "g1", playerId: "p1", token: "t", cityName: "C" });
    const list = s.listAccounts();
    const bob = list.find((a) => a.username === "bob");
    const del = list.find((a) => a.username === "delkana");
    expect(bob).toMatchObject({ displayName: "Bob", banned: false, isAdmin: false, gameCount: 1 });
    expect(del?.isAdmin).toBe(true);
    expect(JSON.stringify(list)).not.toContain("hunter2");
  });

  it("bans a user: drops sessions, blocks login & resume, until reactivated", () => {
    const s = new AccountStore(["delkana"]);
    const r = s.register("bob", "password123", "Bob", "azure");
    if (!r.ok) throw new Error("setup failed");
    expect(s.banUser("bob").ok).toBe(true);
    expect(s.resume(r.sessionToken).ok).toBe(false); // session invalidated
    expect(s.login("bob", "password123").ok).toBe(false); // login blocked
    expect(s.unbanUser("bob").ok).toBe(true);
    expect(s.login("bob", "password123").ok).toBe(true); // back in
  });

  it("refuses to ban admins or unknown accounts", () => {
    const s = new AccountStore(["delkana"]);
    s.register("delkana", "password123", "Del", "crimson");
    expect(s.banUser("delkana").ok).toBe(false);
    expect(s.banUser("ghost").ok).toBe(false);
  });

  it("persists the banned flag across serialize/load", () => {
    const s = new AccountStore(["delkana"]);
    s.register("bob", "password123", "Bob", "azure");
    s.banUser("bob");
    const restored = new AccountStore(["delkana"]);
    restored.load(s.serialize());
    expect(restored.login("bob", "password123").ok).toBe(false);
    expect(restored.listAccounts().find((a) => a.username === "bob")?.banned).toBe(true);
  });
});
