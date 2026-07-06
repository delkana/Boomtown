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

export interface GameTime {
  year: number; // 1-based
  month: number; // 1-based
  monthName: string; // "Jan".."Dec"
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
  const totalMinutes = tick * TICK_MINUTES;
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
  const year = Math.floor(totalWeeks / MONTHS_PER_YEAR) + 1;
  const time = `${pad(hour)}:${pad(minute)}`;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const time12 = `${h12}:${pad(minute)} ${hour < 12 ? "AM" : "PM"}`;
  return {
    year,
    month,
    monthName,
    dayName,
    dayFull,
    hour,
    minute,
    time,
    time12,
    label: `Year ${year} · ${monthName} · ${dayFull} · ${time12}`,
  };
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
