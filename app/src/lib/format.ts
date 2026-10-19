const dayFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const rangeFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** "Tue 20 Oct" for 2026-10-20. */
export const formatDay = (date: string) => dayFormat.format(new Date(`${date}T00:00:00Z`));

/** "19 Oct – 25 Oct". */
export const formatRange = (start: string, end: string) =>
  `${rangeFormat.format(new Date(`${start}T00:00:00Z`))} – ${rangeFormat.format(new Date(`${end}T00:00:00Z`))}`;

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
