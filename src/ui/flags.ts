/**
 * Stylized national flags for each city archetype (presentation only).
 *
 * Each is a compact inline SVG on a 60×40 viewBox, nodding to the region's real
 * flag/iconography with a cyberpunk palette. Rendered via innerHTML in the
 * lobby picker, the game list, and the in-game topbar.
 */

const STAR = (x: number, y: number, size: number, fill: string): string =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="middle" font-family="serif">★</text>`;

/** One trigram bar (solid = yang, or split in two = yin) centered at (cx, y). */
function trigramBar(cx: number, y: number, solid: boolean): string {
  const w = 11;
  const t = 1.7;
  const half = w / 2;
  if (solid) return `<rect x="${cx - half}" y="${y - t / 2}" width="${w}" height="${t}"/>`;
  const seg = (w - 2.4) / 2;
  return (
    `<rect x="${cx - half}" y="${y - t / 2}" width="${seg}" height="${t}"/>` +
    `<rect x="${cx + 1.2}" y="${y - t / 2}" width="${seg}" height="${t}"/>`
  );
}

/** A three-bar Korean trigram, rotated `deg` about its center; pattern top→bottom. */
function trigram(
  cx: number,
  cy: number,
  deg: number,
  pattern: [boolean, boolean, boolean],
): string {
  const step = 3.0;
  const bars = pattern.map((s, i) => trigramBar(cx, cy + (i - 1) * step, s)).join("");
  return `<g fill="#141414" transform="rotate(${deg} ${cx} ${cy})">${bars}</g>`;
}

/** Points string for a 5-pointed star pointing up, outer radius R. */
function starPoints(cx: number, cy: number, R: number): string {
  const r = R * 0.4;
  const pts: string[] = [];
  for (let k = 0; k < 10; k++) {
    const a = ((-90 + k * 36) * Math.PI) / 180;
    const rad = k % 2 === 0 ? R : r;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}
const starFill = (cx: number, cy: number, R: number, fill: string): string =>
  `<polygon points="${starPoints(cx, cy, R)}" fill="${fill}"/>`;
const starOutline = (cx: number, cy: number, R: number, stroke: string, w: number): string =>
  `<polygon points="${starPoints(cx, cy, R)}" fill="none" stroke="${stroke}" stroke-width="${w}"/>`;

/** A filled annular sector (ring slice) from deg0→deg1 clockwise — used for the sickle. */
function arcBand(cx: number, cy: number, ro: number, ri: number, deg0: number, deg1: number): string {
  const a0 = (deg0 * Math.PI) / 180;
  const a1 = (deg1 * Math.PI) / 180;
  const large = Math.abs(deg1 - deg0) > 180 ? 1 : 0;
  const p = (r: number, a: number): string =>
    `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  return `M ${p(ro, a0)} A ${ro} ${ro} 0 ${large} 1 ${p(ro, a1)} L ${p(ri, a1)} A ${ri} ${ri} 0 ${large} 0 ${p(ri, a0)} Z`;
}

const FLAGS: Record<string, string> = {
  pacifica: `
    <rect width="60" height="40" fill="#0b2530"/>
    <rect width="60" height="22" fill="#e8743b"/>
    <circle cx="30" cy="13" r="7" fill="#ffd27a"/>
    <rect y="22" width="60" height="2" fill="#2ec6c0"/>
    <polygon points="0,40 20,20 32,40" fill="#0e3a40"/>
    <polygon points="24,40 44,22 60,40" fill="#124b52"/>`,

  commonwealth: `
    <rect width="60" height="40" fill="#012169"/>
    <line x1="0" y1="0" x2="60" y2="40" stroke="#ffffff" stroke-width="8"/>
    <line x1="60" y1="0" x2="0" y2="40" stroke="#ffffff" stroke-width="8"/>
    <line x1="0" y1="0" x2="60" y2="40" stroke="#c8102e" stroke-width="3"/>
    <line x1="60" y1="0" x2="0" y2="40" stroke="#c8102e" stroke-width="3"/>
    <rect x="24" width="12" height="40" fill="#ffffff"/>
    <rect y="14" width="60" height="12" fill="#ffffff"/>
    <rect x="26" width="8" height="40" fill="#c8102e"/>
    <rect y="16" width="60" height="8" fill="#c8102e"/>`,

  europa: `
    <rect width="60" height="40" fill="#0a2a6a"/>
    ${[0, 45, 90, 135, 180, 225, 270, 315]
      .map((deg) => {
        const r = (deg * Math.PI) / 180;
        return STAR(30 + 13 * Math.sin(r), 21 - 13 * Math.cos(r), 6, "#ffd24a");
      })
      .join("")}`,

  nordic: `
    <rect width="60" height="40" fill="#0b2a3a"/>
    <rect y="17" width="60" height="6" fill="#6ff0e0"/>
    <rect x="16" width="6" height="40" fill="#6ff0e0"/>`,

  japan: `
    <rect width="60" height="40" fill="#ffffff"/>
    <circle cx="30" cy="20" r="11" fill="#bc002d"/>`,

  "united-korea": `
    <rect width="60" height="40" fill="#ffffff"/>
    <rect width="60" height="5" fill="#0047a0"/>
    <rect y="35" width="60" height="5" fill="#0047a0"/>
    <circle cx="30" cy="20" r="10" fill="#cd2e3a"/>
    <path d="M20 20 A 10 10 0 0 1 40 20 Z" fill="#0047a0"/>
    <circle cx="25" cy="20" r="5" fill="#cd2e3a"/>
    <circle cx="35" cy="20" r="5" fill="#0047a0"/>
    ${trigram(11, 11, -28, [true, true, true])}
    ${trigram(49, 11, 28, [true, false, true])}
    ${trigram(11, 29, 28, [false, true, false])}
    ${trigram(49, 29, -28, [false, false, false])}`,

  oceania: `
    <rect width="60" height="40" fill="#6ba3d6"/>
    <rect x="10" width="3" height="40" fill="#ffffff"/>
    <rect x="47" width="3" height="40" fill="#ffffff"/>
    <rect x="13" width="34" height="40" fill="#0a2170"/>
    ${starFill(33, 8, 4.6, "#ffffff")}
    ${starFill(40, 16, 4.4, "#ffffff")}
    ${starFill(23, 21, 4.4, "#ffffff")}
    ${starFill(34, 24, 2.5, "#ffffff")}
    ${starFill(31, 33, 4.4, "#ffffff")}`,

  atlantea: `
    <rect width="60" height="40" fill="#0a1f3a"/>
    ${STAR(30, 29, 28, "#ffffff")}`,

  ussr: `
    <rect width="60" height="40" fill="#e01f26"/>
    <path fill="#f6d500" d="${arcBand(21, 19, 10, 7.5, 95, 265)}"/>
    <rect x="19.2" y="27.5" width="3.2" height="4.2" rx="0.6" fill="#f6d500" transform="rotate(18 20.8 29.6)"/>
    <line x1="12" y1="26.5" x2="23" y2="14" stroke="#f6d500" stroke-width="2.7" stroke-linecap="round"/>
    <rect x="20.6" y="10.3" width="7.8" height="4.3" rx="0.6" fill="#f6d500" transform="rotate(40 24.5 12.4)"/>
    ${starOutline(15, 6.8, 3.4, "#f6d500", 1)}`,

  latam: `
    <rect width="60" height="40" fill="#4aa3e0"/>
    <rect y="27" width="60" height="13" fill="#1f8a4c"/>
    <circle cx="30" cy="17" r="6" fill="#f4c94b"/>
    ${[0, 60, 120, 180, 240, 300]
      .map((deg) => {
        const r = (deg * Math.PI) / 180;
        return `<line x1="${30 + 7 * Math.cos(r)}" y1="${17 + 7 * Math.sin(r)}" x2="${30 + 10 * Math.cos(r)}" y2="${17 + 10 * Math.sin(r)}" stroke="#f4c94b" stroke-width="1.4"/>`;
      })
      .join("")}`,

  gulf: `
    <rect width="60" height="40" fill="#d2202e"/>
    <polygon fill="#17974a" points="0,0 22,0 30,4 22,8 30,12 22,16 30,20 22,24 30,28 22,32 30,36 22,40 0,40"/>
    <rect x="36" y="14" width="12" height="12" fill="#ffffff"/>
    <rect x="36" y="14" width="12" height="12" fill="#ffffff" transform="rotate(45 42 20)"/>
    <rect x="39" y="17" width="6" height="6" fill="#d2202e"/>`,

  india: `
    <rect width="60" height="13.3" fill="#e8863b"/>
    <rect y="13.3" width="60" height="13.4" fill="#f2f2f2"/>
    <rect y="26.7" width="60" height="13.3" fill="#128a3a"/>
    <circle cx="30" cy="20" r="6" fill="none" stroke="#1a2a6a" stroke-width="1.4"/>
    ${[0, 30, 60, 90, 120, 150]
      .map((deg) => {
        const r = (deg * Math.PI) / 180;
        return `<line x1="${30 - 6 * Math.cos(r)}" y1="${20 - 6 * Math.sin(r)}" x2="${30 + 6 * Math.cos(r)}" y2="${20 + 6 * Math.sin(r)}" stroke="#1a2a6a" stroke-width="0.8"/>`;
      })
      .join("")}`,

  taiwan: `
    <rect width="60" height="40" fill="#c0202a"/>
    <rect width="30" height="20" fill="#1b3a8f"/>
    <circle cx="15" cy="10" r="5" fill="#eaf2ff"/>
    ${[0, 45, 90, 135, 180, 225, 270, 315]
      .map((deg) => {
        const r = (deg * Math.PI) / 180;
        return `<line x1="${15 + 4 * Math.cos(r)}" y1="${10 + 4 * Math.sin(r)}" x2="${15 + 7 * Math.cos(r)}" y2="${10 + 7 * Math.sin(r)}" stroke="#eaf2ff" stroke-width="1.4"/>`;
      })
      .join("")}`,

  china: `
    <rect width="60" height="40" fill="#d21f2b"/>
    ${STAR(14, 25, 20, "#ffd24a")}
    ${STAR(28, 9, 7, "#ffd24a")}${STAR(33, 13, 7, "#ffd24a")}${STAR(33, 20, 7, "#ffd24a")}${STAR(28, 24, 7, "#ffd24a")}`,

  "african-union": `
    <rect width="60" height="40" fill="#0e7a4a"/>
    <circle cx="30" cy="20" r="9" fill="none" stroke="#f4c94b" stroke-width="2"/>
    <circle cx="30" cy="20" r="3.4" fill="#f4c94b"/>
    ${[0, 72, 144, 216, 288]
      .map((deg) => {
        const r = ((deg - 90) * Math.PI) / 180;
        return STAR(30 + 9 * Math.cos(r), 21 + 9 * Math.sin(r), 5, "#f4c94b");
      })
      .join("")}`,
};

/** Inline SVG flag markup for an archetype id (falls back to a neutral flag). */
export function flagSvg(archetypeId: string): string {
  const inner = FLAGS[archetypeId] ?? `<rect width="60" height="40" fill="#2a3547"/>`;
  return `<svg viewBox="0 0 60 40" preserveAspectRatio="xMidYMid slice" class="flag-svg">${inner}</svg>`;
}
