import { z } from "zod";

/** Calendar helpers on plain `YYYY-MM-DD` strings (no time zones involved). Weeks start on Monday. */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) {
    return false;
  }
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function toUtc(date: string): Date {
  if (!isIsoDate(date)) {
    throw new Error(`Invalid date: ${date}`);
  }
  return new Date(`${date}T00:00:00Z`);
}

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: string): number {
  return ((toUtc(date).getUTCDay() + 6) % 7) + 1;
}

export function weekStartOf(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** Today's date in the server's time zone (TZ env), as YYYY-MM-DD. */
export function today(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * The week `/plan` opens on `day`: this week while nothing is planned in it
 * yet, else the next one, which is the week still to lay out.
 */
export function weekToPlan(day: string, thisWeekHasMeals: boolean): string {
  const monday = weekStartOf(day);
  return thisWeekHasMeals ? addDays(monday, 7) : monday;
}

/** A week's Monday as it arrives from the browser, for server action input. */
export const weekStartSchema = z
  .string()
  .refine((d) => isIsoDate(d) && weekStartOf(d) === d, "invalid week");
