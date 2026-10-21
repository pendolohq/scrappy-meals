import type { ShopItemView } from "@/lib/shop-list";

import {
  coverMax,
  formatAmounts,
  type ShoppingAmount,
  stillNeeded,
  type TickedAmount,
  type WeekIngredients,
} from "./shopping";

/** A tick or a removal: the line's amounts as the device showed them. */
type Recorded = { lineKey: string; amounts: TickedAmount[] };

/** The week's saved shopping state, as read from the database. */
export type ShopState = {
  ticks: Recorded[];
  hidden: Recorded[];
  /** Ordered by when they were added. */
  extras: { id: string; text: string; checked: boolean }[];
};

type Seen = "open" | "ticked" | "hidden" | { more: ShoppingAmount[] };

/**
 * How a plan line stands against its tick and removal. Both cover the
 * amounts they were made at: when the plan needs more than that, the line
 * comes back unticked with what's still needed.
 */
function standing(
  current: ShoppingAmount[],
  tick: TickedAmount[] | undefined,
  hide: TickedAmount[] | undefined
): Seen {
  if (!tick && !hide) {
    return "open";
  }
  const more = stillNeeded(current, coverMax(tick ?? [], hide ?? []));
  if (more.length > 0) {
    return { more };
  }
  // Ticked wins over removed: the line came back after a removal and was bought.
  if (tick && (!hide || stillNeeded(current, hide).length > 0)) {
    return "ticked";
  }
  return "hidden";
}

/**
 * The checklist: the plan's lines, then its free-text lines, then the extras
 * added by hand. Removed lines are left out until the plan needs more of them.
 * A ticked line the plan has since outgrown reads as unticked with what's
 * still needed; ticks for lines that left the plan are simply never looked up.
 */
export function buildShopItems(
  plan: WeekIngredients,
  state: ShopState
): ShopItemView[] {
  const ticks = new Map(state.ticks.map((t) => [t.lineKey, t.amounts]));
  const hidden = new Map(state.hidden.map((h) => [h.lineKey, h.amounts]));
  const items: Omit<ShopItemView, "position">[] = [];

  for (const l of plan.lines) {
    const seen = standing(l.amounts, ticks.get(l.key), hidden.get(l.key));
    if (seen === "hidden") {
      continue;
    }
    const outgrown = typeof seen === "object";
    items.push({
      id: l.key,
      source: "plan",
      text: l.foodName,
      amount: outgrown
        ? `${formatAmounts(seen.more)} more`
        : l.amounts.length > 0
          ? formatAmounts(l.amounts)
          : null,
      detail: outgrown
        ? `${formatAmounts(l.amounts)} in all`
        : l.recipes.map((r) => r.name).join(", "),
      aisle: l.aisle,
      checked: seen === "ticked",
      amounts: l.amounts.map((a) => ({ quantity: a.quantity, unit: a.unit })),
    });
  }
  for (const f of plan.freeText) {
    // A free-text line's amount is how many meals need it.
    const times: ShoppingAmount = {
      quantity: f.times,
      unit: null,
      standard: null,
    };
    const seen = standing([times], ticks.get(f.key), hidden.get(f.key));
    if (seen === "hidden") {
      continue;
    }
    const outgrown = typeof seen === "object";
    items.push({
      id: f.key,
      source: "plan",
      text: f.times > 1 ? `${f.text} (×${f.times})` : f.text,
      amount: outgrown ? `×${seen.more[0]?.quantity} more` : null,
      detail: f.recipeName,
      aisle: "Other",
      checked: seen === "ticked",
      amounts: [{ quantity: f.times, unit: null }],
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
