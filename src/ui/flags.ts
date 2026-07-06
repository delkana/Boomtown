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
    <rect width="60" height="40" fill="#1b2a52"/>
    <polygon fill="#ffffff" points="0,16 6,13 10,16 16,11 21,15 30,9 38,14 44,10.5 49,15 54,12 60,16 60,35 0,35"/>
    <rect y="35" width="60" height="5" fill="#2f6a33"/>
    ${starFill(30, 5, 3, "#ffffff")}
    <polygon fill="#b31942" points="16.5,27.2 17.5,25.6 19.5,24.3 20.3,23.1 21.2,24 23.5,22.1 29,22.5 35,22.5 39,22.9 41.6,23.9 42.6,25.2 42.7,26.2 41.9,26.6 41.8,27.2 41.5,32 39.8,32 39.9,28.6 37,28.9 36,32 34.5,32 34.7,28.6 30,29 28,32 26.5,32 26.8,28.3 24.3,28.5 23.4,32 22,32 22.4,27.6 19,27.7"/>`,

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
    <rect width="60" height="40" fill="#f4a800"/>
    <line x1="0" y1="0" x2="60" y2="40" stroke="#cc1f2e" stroke-width="6"/>
    <line x1="60" y1="0" x2="0" y2="40" stroke="#cc1f2e" stroke-width="6"/>
    <polygon points="30,5 53,20 30,35 7,20" fill="#123a78"/>
    ${Array.from({ length: 16 }, (_, k) => {
      const a = (k * 22.5 * Math.PI) / 180;
      const r0 = 5.4;
      const r1 = 9.6;
      const w = (5 * Math.PI) / 180;
      const pt = (r: number, ang: number): string =>
        `${(30 + r * Math.cos(ang)).toFixed(2)},${(20 + r * Math.sin(ang)).toFixed(2)}`;
      return `<polygon points="${pt(r1, a)} ${pt(r0, a - w)} ${pt(r0, a + w)}" fill="#f4a800"/>`;
    }).join("")}
    <circle cx="30" cy="20" r="4.6" fill="#f4a800" stroke="#123a78" stroke-width="0.9"/>`,

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
    <rect width="60" height="40" fill="#3f7a54"/>
    ${Array.from({ length: 40 }, (_, k) => {
      const a = ((k * 9 - 90) * Math.PI) / 180;
      const r0 = 5.5;
      const r1 = 14;
      const w = (2.4 * Math.PI) / 180;
      const pt = (r: number, ang: number): string =>
        `${(30 + r * Math.cos(ang)).toFixed(2)},${(20 + r * Math.sin(ang)).toFixed(2)}`;
      return `<polygon points="${pt(r1, a)} ${pt(r0, a - w)} ${pt(r0, a + w)}" fill="#ffffff"/>`;
    }).join("")}
    <polygon fill="#ffffff" points="30,11 34,11.2 36.5,12 37.5,13.8 38.8,15.2 40,16.8 37.6,17.6 37,19.2 35.8,22 34.2,25 32.6,27.6 31.2,29.2 29.8,27.6 28.4,24.4 27,21 25.6,18.4 26.4,16.6 24.2,15.6 24,13.6 25.4,12 27.4,11.4"/>
    <ellipse cx="39.6" cy="24.5" rx="0.9" ry="2.2" fill="#ffffff" transform="rotate(-18 39.6 24.5)"/>
    ${Array.from({ length: 48 }, (_, k) => {
      const a = ((k * (360 / 48) - 90) * Math.PI) / 180;
      return starFill(30 + 17.5 * Math.cos(a), 20 + 17.5 * Math.sin(a), 0.85, "#f2c33d");
    }).join("")}`,
};

/** Inline SVG flag markup for an archetype id (falls back to a neutral flag). */
export function flagSvg(archetypeId: string): string {
  const inner = FLAGS[archetypeId] ?? `<rect width="60" height="40" fill="#2a3547"/>`;
  return `<svg viewBox="0 0 60 40" preserveAspectRatio="xMidYMid slice" class="flag-svg">${inner}</svg>`;
}
