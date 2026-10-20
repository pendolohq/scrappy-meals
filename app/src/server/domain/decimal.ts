/**
 * What "1,200" or "1.200" means: a thousands separator, or three decimal
 * places. Pages are scraped in either locale, so the separator can't tell; the
 * caller decides from what the value measures.
 */
export type ThreeDigitGroup = "thousands" | "refuse";

/**
 * How each macro reads "1,200" or "1.200", which means 1200 on some pages and
 * 1.2 on others. Nobody gives calories to three decimals, so for kcal it is a
 * thousand; over a kilo of protein a serving isn't plausible either, but 1.2 g
 * is, so grams are left for a person to check.
 */
export const THREE_DIGIT_GROUP = {
  kcal: "thousands",
  protein: "refuse",
  carbs: "refuse",
  fat: "refuse",
  fibre: "refuse",
} as const satisfies Record<string, ThreeDigitGroup>;

const DIGITS = /^\d+$/;
const GROUP = /^\d{3}$/;

/** "1.200.000" style: a short first group, then groups of exactly three. */
const isGrouped = (parts: string[]) =>
  parts.length > 1 &&
  /^\d{1,3}$/.test(parts[0]) &&
  parts[0] !== "0" &&
  parts.slice(1).every((p) => GROUP.test(p));

/**
 * Reads a non-negative number written with either decimal mark ("12.5",
 * "12,5"), with or without thousands separators in either style ("1,200.5",
 * "1.200,5"). Null when the text isn't such a number, or is a lone group of
 * three ("1,200") and the caller refuses to guess.
 */
export function parseDecimal(
  text: string,
  threeDigitGroup: ThreeDigitGroup
): number | null {
  const t = text.trim();
  if (DIGITS.test(t)) {
    return Number(t);
  }
  if (!/^\d[\d.,]*\d$/.test(t)) {
    return null;
  }
  const hasDot = t.includes(".");
  const hasComma = t.includes(",");
  if (hasDot && hasComma) {
    // The last mark is the decimal one; the other only groups thousands.
    const decimalMark = t.lastIndexOf(".") > t.lastIndexOf(",") ? "." : ",";
    const groupMark = decimalMark === "." ? "," : ".";
    const [whole, fraction, ...rest] = t.split(decimalMark);
    if (rest.length > 0 || !DIGITS.test(fraction)) {
      return null;
    }
    const groups = whole.split(groupMark);
    return isGrouped(groups) ? Number(`${groups.join("")}.${fraction}`) : null;
  }
  const parts = t.split(hasDot ? "." : ",");
  if (parts.length === 2 && !isGrouped(parts)) {
    return Number(`${parts[0]}.${parts[1]}`);
  }
  if (isGrouped(parts)) {
    // Several groups ("1.200.000") can only be thousands.
    return threeDigitGroup === "thousands" || parts.length > 2
      ? Number(parts.join(""))
      : null;
  }
  return null;
}
