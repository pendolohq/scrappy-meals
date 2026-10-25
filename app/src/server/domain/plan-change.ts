/** What undoing a plan change needs: kept as jsonb on its `plan_changes` row. */
export type PlanChangeSnapshot = {
  /** Meals the change created: undo removes the ones still in the week. */
  added: string[];
  /**
   * Portions the change overwrote: `before` is what undo puts back, `after`
   * what the change wrote (as stored, to 2 decimals). A portion edited since
   * no longer equals `after` and is left alone.
   */
  portions: {
    mealSlotId: string;
    userId: string;
    before: number;
    after: number;
  }[];
};
