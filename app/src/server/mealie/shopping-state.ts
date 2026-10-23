/**
 * A recipe the shopping list leaves out (a cappuccino from the café, a snack
 * bought at work), kept in the recipe's `extras` like the import state, so
 * it travels with the recipe.
 */
export const NO_SHOPPING_EXTRA = "scrappyNoShopping";

/** Whether the shopping list leaves the recipe out. */
export const readNoShopping = (
  extras: Record<string, unknown> | null | undefined
): boolean => extras?.[NO_SHOPPING_EXTRA] === "true";

/**
 * The recipe's extras with the flag written in, or taken out when off. Other
 * keys are kept: a PATCH replaces `extras` as a whole.
 */
export function withNoShopping(
  extras: Record<string, unknown> | null | undefined,
  on: boolean
): Record<string, string> {
  const next = Object.fromEntries(
    Object.entries(extras ?? {}).filter(
      (e): e is [string, string] => typeof e[1] === "string"
    )
  );
  if (on) {
    next[NO_SHOPPING_EXTRA] = "true";
  } else {
    delete next[NO_SHOPPING_EXTRA];
  }
  return next;
}
