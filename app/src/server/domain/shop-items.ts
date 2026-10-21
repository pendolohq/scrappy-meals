import type { ShopItemView } from "@/lib/shop-list";

import {
  formatAmounts,
  stillNeeded,
  type TickedAmount,
  type WeekIngredients,
} from "./shopping";

/** The week's saved shopping state, as read from the database. */
export type ShopState = {
  ticks: { lineKey: string; amounts: TickedAmount[] }[];
  hidden: string[];
  /** Ordered by when they were added. */
  extras: { id: string; text: string; checked: boolean }[];
};

/**
 * The checklist: the plan's lines, then its free-text lines, then the extras
 * added by hand. Hidden lines are left out. A ticked line the plan has since
 * outgrown reads as unticked with what's still needed; ticks for lines that
 * left the plan are simply never looked up.
 */
export function buildShopItems(
  plan: WeekIngredients,
  state: ShopState
): ShopItemView[] {
  const ticks = new Map(state.ticks.map((t) => [t.lineKey, t.amounts]));
  const hidden = new Set(state.hidden);
  const items: Omit<ShopItemView, "position">[] = [];

  for (const l of plan.lines) {
    if (hidden.has(l.key)) {
      continue;
    }
    const ticked = ticks.get(l.key);
    const more = ticked ? stillNeeded(l.amounts, ticked) : [];
    const outgrown = more.length > 0;
    items.push({
      id: l.key,
      source: "plan",
      text: l.foodName,
      amount: outgrown
        ? `${formatAmounts(more)} more`
        : l.amounts.length > 0
          ? formatAmounts(l.amounts)
          : null,
      detail: outgrown
        ? `${formatAmounts(l.amounts)} in all`
        : l.recipes.map((r) => r.name).join(", "),
      aisle: l.aisle,
      checked: ticked !== undefined && !outgrown,
      amounts: l.amounts.map((a) => ({ quantity: a.quantity, unit: a.unit })),
    });
  }
  for (const f of plan.freeText) {
    if (hidden.has(f.key)) {
      continue;
    }
    items.push({
      id: f.key,
      source: "plan",
      text: f.times > 1 ? `${f.text} (×${f.times})` : f.text,
      amount: null,
      detail: f.recipeName,
      aisle: "Other",
      checked: ticks.has(f.key),
      amounts: [],
    });
  }
  for (const e of state.extras) {
    items.push({
      id: e.id,
      source: "extra",
      text: e.text,
      amount: null,
      detail: null,
      aisle: "Other",
      checked: e.checked,
      amounts: [],
    });
  }
  return items.map((item, position) => ({ ...item, position }));
}
