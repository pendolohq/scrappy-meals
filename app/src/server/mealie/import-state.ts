/**
 * Where a recipe stands after being imported through the planner. Kept in the
 * recipe's `extras` in Mealie (string key/values), so it travels with the
 * recipe and its backups instead of living in a planner table.
 */
export type ImportState = {
  /** Recipes added in Mealie directly have no review step: they count as done. */
  review: "pending" | "done";
  /**
   * Where the nutrition came from. `estimated` is AI-filled and not yet
   * checked; `reviewed` was confirmed or edited by someone. Null when the
   * recipe wasn't imported through the planner.
   */
  nutrition: "source" | "estimated" | "reviewed" | null;
};

export const IMPORT_EXTRAS = {
  review: "scrappyReview",
  nutrition: "scrappyNutrition",
} as const;

const NUTRITION_SOURCES = ["source", "estimated", "reviewed"] as const;

export function readImportState(
  extras: Record<string, unknown> | null | undefined
): ImportState {
  const review = extras?.[IMPORT_EXTRAS.review];
  const nutrition = extras?.[IMPORT_EXTRAS.nutrition];
  return {
    review: review === "pending" ? "pending" : "done",
    nutrition: NUTRITION_SOURCES.find((s) => s === nutrition) ?? null,
  };
}

/**
 * The recipe's extras with the import state written in. Other keys are kept:
 * a PATCH replaces `extras` as a whole.
 */
export function withImportState(
  extras: Record<string, unknown> | null | undefined,
  state: ImportState
): Record<string, string> {
  const kept = Object.fromEntries(
    Object.entries(extras ?? {}).filter(
      (e): e is [string, string] => typeof e[1] === "string"
    )
  );
  const next: Record<string, string> = {
    ...kept,
    [IMPORT_EXTRAS.review]: state.review,
  };
  if (state.nutrition) {
    next[IMPORT_EXTRAS.nutrition] = state.nutrition;
  } else {
    delete next[IMPORT_EXTRAS.nutrition];
  }
  return next;
}
