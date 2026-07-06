import { DAYS_PER_WEEK, MONTHS_PER_YEAR, TICK_MINUTES } from "./constants";

/**
 * In-game calendar — a pure function of the tick counter, so client and server
 * always agree. Each tick is TICK_MINUTES of game time. A "month" is exactly one
 * week (7 days), and a year is MONTHS_PER_YEAR months. Years start at "Year 1".
 */
export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

export interface GameTime {
  year: number; // 1-based
  month: number; // 1-based
  monthName: string; // "Jan".."Dec"
  dayName: string;
  hour: number; // 0..23
  minute: number; // 0..59
  time: string; // "HH:MM"
  /** Compact one-line label for the clock. */
  label: string;
}

export function gameTime(tick: number): GameTime {
  const totalMinutes = tick * TICK_MINUTES;
  const minute = totalMinutes % 60;
  const hour = Math.floor(totalMinutes / 60) % 24;
  const totalDays = Math.floor(totalMinutes / (60 * 24));
  const dayName = DAY_NAMES[((totalDays % DAYS_PER_WEEK) + DAYS_PER_WEEK) % DAYS_PER_WEEK];
  const totalWeeks = Math.floor(totalDays / DAYS_PER_WEEK); // one week == one month
  const monthIdx = totalWeeks % MONTHS_PER_YEAR;
  const month = monthIdx + 1;
  const monthName = MONTH_NAMES[monthIdx];
  const year = Math.floor(totalWeeks / MONTHS_PER_YEAR) + 1;
  const time = `${pad(hour)}:${pad(minute)}`;
  return {
    year,
    month,
    monthName,
    dayName,
    hour,
    minute,
    time,
    label: `${dayName} · ${monthName} · Year ${year} · ${time}`,
  };
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
