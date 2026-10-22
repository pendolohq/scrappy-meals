const LENGTHS = [8, 12, 13, 14];

/** GS1 check digit: from the right of the body, weights 3, 1, 3, 1, ... */
function checkDigitValid(code: string): boolean {
  const body = code.slice(0, -1);
  const sum = [...body].reduce(
    (total, digit, i) =>
      total + Number(digit) * ((body.length - i) % 2 === 1 ? 3 : 1),
    0
  );
  return (10 - (sum % 10)) % 10 === Number(code.at(-1));
}

/**
 * The canonical form of a typed or scanned barcode, or null when it isn't
 * one. Spaces and hyphens are ignored; the length must be 8, 12, 13 or 14 and
 * the check digit right. A UPC-A (12) gets a leading 0 and a GTIN-14 starting
 * with 0 loses it, so one product has one key whichever way it was read.
 */
export function parseBarcode(input: string): string | null {
  const code = input.replace(/[\s-]/g, "");
  if (
    !/^\d+$/.test(code) ||
    !LENGTHS.includes(code.length) ||
    /^0+$/.test(code) ||
    !checkDigitValid(code)
  ) {
    return null;
  }
  if (code.length === 12) {
    return `0${code}`;
  }
  return code.length === 14 && code.startsWith("0") ? code.slice(1) : code;
}
