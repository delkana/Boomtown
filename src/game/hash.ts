/**
 * FNV-1a string hash → unsigned 32-bit int. Used to derive stable, deterministic
 * pseudo-random values for city generation (plot widths, feature placement,
 * names) from `(gameId, …)` keys — no Math.random, so generation is reproducible
 * on client and server alike.
 */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
