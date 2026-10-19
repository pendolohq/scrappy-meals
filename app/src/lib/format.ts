// Hand-rolled rather than Intl: browsers and Node ship different locale data
// ("Thu, 22 Oct" vs "Thu 22 Oct"), which would make server and client disagree.
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const utc = (date: string) => new Date(`${date}T00:00:00Z`);
const dayMonth = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;

/** "Tue 20 Oct" for 2026-10-20. */
export const formatDay = (date: string) => {
  const d = utc(date);
  return `${WEEKDAYS[d.getUTCDay()]} ${dayMonth(d)}`;
};

/** "19 Oct – 25 Oct". */
export const formatRange = (start: string, end: string) => `${dayMonth(utc(start))} – ${dayMonth(utc(end))}`;

const FRACTIONS: Record<number, string> = { 0.25: "¼", 0.5: "½", 0.75: "¾" };

/** 1.5 -> "1½", 0.25 -> "¼", 2 -> "2", 1.3 -> "1.3". */
export function formatPortion(n: number): string {
  const whole = Math.floor(n);
  const frac = Math.round((n - whole) * 100) / 100;
  if (frac === 0) return String(whole);
  const glyph = FRACTIONS[frac];
  if (!glyph) return String(Math.round(n * 100) / 100);
  return whole === 0 ? glyph : `${whole}${glyph}`;
}

export const formatAmount = (n: number) => String(Math.round(n));
