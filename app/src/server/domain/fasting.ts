import { isoWeekday } from "./week";

/** A per-day override wins; otherwise the person's default fasting weekdays apply. */
export function isFasting(
  defaultFastingDays: number[],
  date: string,
  override?: boolean | null
): boolean {
  if (override !== undefined && override !== null) {
    return override;
  }
  return defaultFastingDays.includes(isoWeekday(date));
}
