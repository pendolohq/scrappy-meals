import type { SlotType } from "./slots";

/** What undoing a plan change needs: kept as jsonb on its `plan_changes` row. */
export type PlanChangeSnapshot = {
  /** Meals the change created: undo removes the ones still there. */
  added: string[];
  /** Meals the change removed, with their portions: undo puts them back. */
  removed: {
    meal: {
      id: string;
      date: string;
      slot: SlotType;
      snackIndex: number;
      position: number;
      slug: string;
      baseServings: number;
      unplanned: boolean;
      createdBy: string | null;
    };
    portions: { userId: string; multiplier: number }[];
  }[];
  /** Portion values the change overwrote, as they were before. */
  portions: { mealSlotId: string; userId: string; multiplier: number }[];
};
