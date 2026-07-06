import { CA_BEAR_PATHS } from "./caBear";

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

/**
 * Authentic hammer, sickle and star from the public-domain Flag of the Soviet
 * Union (Wikimedia Flag_of_the_Soviet_Union.svg). Raw coordinates in the source
 * 1200x600 space; positioned via a transform where used.
 */
const SOVIET_EMBLEM = `<path fill-rule="evenodd" d="m 200.0005,37.5 -8.41933,25.911886 H 164.336 L 186.37777,79.426122 177.95844,105.338 200.0005,89.323465 222.04257,105.338 213.62324,79.426122 235.665,63.411886 h -27.24516 z m 0,13.499987 5.38828,16.583473 h 17.43718 l -14.107,10.249496 5.38827,16.583472 L 200.0005,84.167224 185.89378,94.416428 191.28205,77.832956 177.17504,67.58346 h 17.43718 z"/><g transform="matrix(0.98931879,0,0,0.98673811,3.8297658,3.7659398)"><path d="m 137.43744,171.69421 18.86296,18.9937 17.78834,-17.66589 c 27.05847,29.021 55.43807,56.99501 82.28704,86.12782 4.03444,4.06233 10.59815,4.085 14.66056,0.0506 4.06232,-4.03445 4.08499,-10.59815 0.0506,-14.66056 -28.81871,-27.1901 -57.72545,-54.60143 -86.55328,-81.89095 l 23.96499,-23.80003 -33.34026,-4.61605 z"/><path d="m 198.2887,110.1955 c 15.51743,8.7394 27.29872,21.28122 34.2484,34.3924 7.04394,13.28902 10.13959,27.16218 10.20325,38.25433 0.13054,22.74374 -18.43771,41.18184 -41.18183,41.18184 -12.13597,0 -23.04607,-5.24868 -30.58302,-13.60085 l -4.16863,3.51033 c -0.70999,-0.27231 -1.46387,-0.41221 -2.22429,-0.41276 -1.82948,1.9e-4 -3.56621,0.80531 -4.74859,2.20136 -2.97368,0.38896 -5.46251,2.44529 -6.40534,5.29224 -3.13486,6.28843 -8.63524,11.21997 -15.29104,13.4776 -0.0637,0.0216 -0.11992,0.05 -0.1758,0.0783 -3.07749,1.12758 -6.16259,3.1643 -8.78919,5.80245 -5.19155,5.23656 -7.72858,11.93658 -6.30024,16.63822 -0.14098,0.40857 -0.21361,0.83759 -0.21498,1.26979 1.5e-4,2.17082 1.75991,3.93058 3.93073,3.93073 0.54341,-0.002 1.08053,-0.11639 1.57745,-0.33632 4.69369,1.05881 11.06885,-1.54582 16.05444,-6.55917 2.82624,-2.85072 4.94356,-6.22349 5.98303,-9.53062 2.31696,-6.62278 7.29699,-12.01856 13.62281,-15.05312 0.15105,-0.0725 0.27303,-0.14714 0.38218,-0.22358 2.12082,-1.01408 3.67251,-2.92895 4.225,-5.2139 9.70222,11.44481 24.25255,18.75299 40.51876,19.13577 29.83352,0.70205 52.13299,-21.25802 53.16414,-52.83642 0.51894,-15.89259 -5.62993,-36.3847 -19.6412,-53.19089 -10.70835,-12.84441 -26.40987,-23.50795 -44.18699,-28.20777 z"/></g>`;

const FLAGS: Record<string, string> = {
  pacifica: `
    <rect width="60" height="40" fill="#1b2a52"/>
    <polygon fill="#ffffff" points="0,16 6,13 10,16 16,11 21,15 30,9 38,14 44,10.5 49,15 54,12 60,16 60,35 0,35"/>
    <rect y="35" width="60" height="5" fill="#2f6a33"/>
    ${starFill(30, 5, 3, "#ffffff")}
    <g fill="#b31942" transform="translate(1.87 10) scale(0.0625)">${CA_BEAR_PATHS}</g>`,

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
    <rect width="60" height="40" fill="#e21a23"/>
    <g fill="#ffd700" transform="translate(-3.94 0.17) scale(0.0755)">${SOVIET_EMBLEM}</g>`,

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
    <rect width="60" height="40" fill="#ee1c25"/>
    ${starFill(10, 10, 6, "#ffde00")}
    <g transform="rotate(239.04 20 4)">${starFill(20, 4, 2, "#ffde00")}</g>
    <g transform="rotate(261.87 24 8)">${starFill(24, 8, 2, "#ffde00")}</g>
    <g transform="rotate(-74.05 24 14)">${starFill(24, 14, 2, "#ffde00")}</g>
    <g transform="rotate(-51.34 20 18)">${starFill(20, 18, 2, "#ffde00")}</g>`,

  "straits-union": `
    <rect width="60" height="40" fill="#ffffff"/>
    <rect width="60" height="20" fill="#ee2536"/>
    <circle cx="12" cy="10.5" r="6" fill="#ffffff"/>
    <circle cx="14.3" cy="10" r="5.1" fill="#ee2536"/>
    ${Array.from({ length: 5 }, (_, k) => {
      const a = ((k * 72 - 90) * Math.PI) / 180;
      return starFill(20.5 + 3.2 * Math.cos(a), 10.5 + 3.2 * Math.sin(a), 1.3, "#ffffff");
    }).join("")}`,

  "african-union": `
    <rect width="60" height="40" fill="#3f7a54"/>
    ${Array.from({ length: 40 }, (_, k) => {
      const a = ((k * 9 - 90) * Math.PI) / 180;
      const r0 = 4.5;
      const r1 = 13.5;
      const w = (2.4 * Math.PI) / 180;
      const pt = (r: number, ang: number): string =>
        `${(30 + r * Math.cos(ang)).toFixed(2)},${(20 + r * Math.sin(ang)).toFixed(2)}`;
      return `<polygon points="${pt(r1, a)} ${pt(r0, a - w)} ${pt(r0, a + w)}" fill="#ffffff"/>`;
    }).join("")}
    <circle cx="30" cy="20" r="4.7" fill="#ffffff"/>
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
