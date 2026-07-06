import { DAYS_PER_WEEK, MONTHS_PER_YEAR, TICK_MINUTES } from "./constants";

/**
 * In-game calendar — a pure function of the tick counter, so client and server
 * always agree. Each tick is TICK_MINUTES of game time. A "month" is exactly one
 * week (7 days), and a year is MONTHS_PER_YEAR months. Years start at "Year 1".
 */
export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const DAY_NAMES_FULL = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
] as const;
export const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;
export const MONTH_NAMES_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export interface GameTime {
  year: number; // 1-based
  month: number; // 1-based
  monthName: string; // "Jan".."Dec"
  monthFull: string; // "January".."December"
  dayName: string; // "Mon".."Sun"
  dayFull: string; // "Monday".."Sunday"
  hour: number; // 0..23
  minute: number; // 0..59
  time: string; // 24h "HH:MM"
  time12: string; // "h:MM AM/PM"
  /** One-line label for the clock: Year, month, weekday, time (AM/PM). */
  label: string;
}

export function gameTime(tick: number): GameTime {
  return gameTimeFromMinutes(tick * TICK_MINUTES);
}

/** Day of week for a tick: 0 = Monday … 6 = Sunday (matches DAY_NAMES). */
export function dayOfWeek(tick: number): number {
  const totalDays = Math.floor((tick * TICK_MINUTES) / (60 * 24));
  return ((totalDays % DAYS_PER_WEEK) + DAYS_PER_WEEK) % DAYS_PER_WEEK;
}

/**
 * Build a GameTime from an absolute count of in-game minutes. Lets the HUD show
 * a smoothly-advancing clock (minute by minute) between the coarse 5-minute
 * economy ticks — pass `tick * TICK_MINUTES + interpolatedMinutes`.
 */
export function gameTimeFromMinutes(totalMinutesRaw: number): GameTime {
  const totalMinutes = Math.floor(totalMinutesRaw);
  const minute = totalMinutes % 60;
  const hour = Math.floor(totalMinutes / 60) % 24;
  const totalDays = Math.floor(totalMinutes / (60 * 24));
  const dow = ((totalDays % DAYS_PER_WEEK) + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  const dayName = DAY_NAMES[dow];
  const dayFull = DAY_NAMES_FULL[dow];
  const totalWeeks = Math.floor(totalDays / DAYS_PER_WEEK); // one week == one month
  const monthIdx = totalWeeks % MONTHS_PER_YEAR;
  const month = monthIdx + 1;
  const monthName = MONTH_NAMES[monthIdx];
  const monthFull = MONTH_NAMES_FULL[monthIdx];
  const year = Math.floor(totalWeeks / MONTHS_PER_YEAR) + 1;
  const time = `${pad(hour)}:${pad(minute)}`;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const time12 = `${h12}:${pad(minute)} ${hour < 12 ? "AM" : "PM"}`;
  return {
    year,
    month,
    monthName,
    monthFull,
    dayName,
    dayFull,
    hour,
    minute,
    time,
    time12,
    label: `Year ${year} · ${monthFull} · ${dayFull} · ${time12}`,
  };
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/* --------------------------------------------------------------------- *
 * Sun model — latitude + season drive how long the day is.               *
 *                                                                        *
 * The calendar's 12 "months" stand in for a year, so we derive a solar   *
 * declination from the month (winter near Jan, summer near Jul for the   *
 * northern hemisphere) and combine it with latitude to get sunrise /     *
 * sunset. Pure and deterministic, so the sky matches on every client.    *
 * --------------------------------------------------------------------- */

const DEG = Math.PI / 180;
/** Earth's axial tilt — the amplitude of the seasonal sun swing. */
const AXIAL_TILT = 23.44 * DEG;

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Fractional month-of-year in [0, 12) for a tick (0 = Jan 1, 6 = mid-year). */
function monthFloat(tick: number): number {
  const totalMinutes = tick * TICK_MINUTES;
  const dayMinutes = 60 * 24;
  const totalDays = Math.floor(totalMinutes / dayMinutes);
  const yearLen = DAYS_PER_WEEK * MONTHS_PER_YEAR;
  const dayOfYear = ((totalDays % yearLen) + yearLen) % yearLen;
  const frac = (totalMinutes % dayMinutes) / dayMinutes;
  return (dayOfYear + frac) / DAYS_PER_WEEK;
}

/** Solar declination (radians) for a tick: −tilt near Jan, +tilt near Jul. */
function declination(tick: number): number {
  return -AXIAL_TILT * Math.cos((2 * Math.PI * monthFloat(tick)) / MONTHS_PER_YEAR);
}

/**
 * Hours of daylight at a latitude on a given tick's date. Handles the poles:
 * beyond the polar circles this saturates to 0 (polar night) or 24 (midnight
 * sun) instead of returning NaN.
 */
export function daylightHours(latitudeDeg: number, tick: number): number {
  const phi = clamp(latitudeDeg, -89.5, 89.5) * DEG;
  const decl = declination(tick);
  const cosH = clamp(-Math.tan(phi) * Math.tan(decl), -1, 1);
  const H = Math.acos(cosH); // half-day arc, radians
  return (24 * H) / Math.PI;
}

export interface SkyState {
  /** Sun-above-horizon brightness, 0 (night) .. 1 (bright noon). */
  day: number;
  /** Dawn/dusk warmth, peaking at sunrise and sunset. */
  twilight: number;
}

/**
 * Sky lighting for a tick at a latitude: how bright it is and how much
 * sunrise/sunset warmth to blend in. Day length and the sun's noon height both
 * swing with the season, so high-latitude winters are short and dim while
 * summers are long and bright.
 */
export function skyState(tick: number, latitudeDeg: number): SkyState {
  const t = gameTime(tick);
  const hourF = t.hour + t.minute / 60;
  const dayHours = daylightHours(latitudeDeg, tick);

  if (dayHours <= 0) return { day: 0, twilight: 0 }; // polar night
  if (dayHours >= 24) {
    // Midnight sun: never sets, but still dips toward the horizon around 'night'.
    const swing = 0.5 + 0.4 * Math.sin(2 * Math.PI * ((hourF - 6) / 24));
    return { day: clamp(swing, 0.2, 1), twilight: 0 };
  }

  const sunrise = 12 - dayHours / 2;
  const sunset = 12 + dayHours / 2;

  // Noon sun height (0..1) dims low-sun seasons even at midday.
  const phi = clamp(latitudeDeg, -89.5, 89.5) * DEG;
  const decl = declination(tick);
  const noon = clamp(Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl), 0, 1);

  let day = 0;
  if (hourF > sunrise && hourF < sunset) {
    const frac = (hourF - sunrise) / (sunset - sunrise); // 0 at sunrise, 1 at sunset
    day = Math.max(0, Math.sin(Math.PI * frac)) * (0.35 + 0.65 * noon);
  }
  const twilight = Math.min(
    1,
    Math.max(0, 1 - Math.abs(hourF - sunrise) / 1.5) + Math.max(0, 1 - Math.abs(hourF - sunset) / 1.5),
  );
  return { day, twilight };
}
