import Link from "next/link";
import { redirect } from "next/navigation";

import { AutoRefresh } from "@/components/auto-refresh";
import { formatRange } from "@/lib/format";
import type { ShopItemView } from "@/lib/shop-list";
import { getDb } from "@/server/db/client";
import type { WeekIngredients } from "@/server/domain/shopping";
import { addDays, isIsoDate, weekStartOf } from "@/server/domain/week";
import { isMealieUnavailable } from "@/server/mealie/client";
import { requireUser } from "@/server/session";
import { type ShopList, weekShopList } from "@/server/shop";
import { lastPush, weekShoppingList } from "@/server/shopping";

import { PushButton } from "./push-button";
import { ShopChecklist } from "./shop-checklist";

export const dynamic = "force-dynamic";

const formatQty = (n: number) => String(Math.round(n * 100) / 100);

/** What the plan needs, as it will be sent to Mealie. */
const Preview = ({ list }: { list: WeekIngredients }) => {
  if (list.lines.length === 0 && list.freeText.length === 0) {
    return (
      <p className="text-sm text-muted">
        Nothing planned to eat this week yet.
      </p>
    );
  }
  return (
    <>
      <section className="rounded-xl border border-border bg-card p-3">
        <h2 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">
          {list.lines.length} item{list.lines.length === 1 ? "" : "s"}
        </h2>
        <ul className="divide-y divide-border" data-testid="lines">
          {list.lines.map((l) => (
            <li
              key={l.key}
              className="flex items-baseline justify-between gap-3 py-1.5 text-sm"
            >
              <span className="min-w-0">
                <span className="font-medium">{l.foodName}</span>
                <span className="block truncate text-xs text-muted">
                  {l.recipes.map((r) => r.name).join(", ")}
                </span>
              </span>
              <span className="shrink-0 tabular-nums" data-testid="qty">
                {l.quantity === null
                  ? "–"
                  : `${formatQty(l.quantity)}${l.unit ? ` ${l.unit}` : ""}`}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {list.freeText.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-3">
          <h2 className="text-xs font-medium tracking-wide text-muted uppercase">
            Check these
          </h2>
          <p className="mb-2 text-xs text-muted">
            Mealie hasn&apos;t parsed these lines, so they&apos;re added as
            written.
          </p>
          <ul className="space-y-1 text-sm" data-testid="free-text">
            {list.freeText.map((f, i) => (
              <li key={`${f.recipeId}-${i}`}>
                {f.text}
                {f.times > 1 ? ` (×${f.times})` : ""}{" "}
                <span className="text-xs text-muted">· {f.recipeName}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
};

export default async function ShoppingPage({
  params,
}: {
  params: Promise<{ weekStart: string }>;
}) {
  await requireUser();
  const { weekStart } = await params;
  if (!isIsoDate(weekStart)) {
    redirect("/week");
  }
  if (weekStartOf(weekStart) !== weekStart) {
    redirect(`/week/${weekStartOf(weekStart)}/shopping`);
  }

  const db = getDb();
  const [plan, pushed] = await Promise.all([
    weekShoppingList(db, weekStart),
    lastPush(db, weekStart),
  ]);
  // Null when nothing was sent yet or the list is gone from Mealie: then the
  // page is the preview with "Send to Mealie".
  let shop: ShopList | null = null;
  let mealieDown = false;
  if (pushed) {
    try {
      shop = await weekShopList(db, weekStart);
    } catch (err) {
      if (!isMealieUnavailable(err)) {
        throw err;
      }
      mealieDown = true;
    }
  }
  const sent = shop !== null || mealieDown;
  const needed = plan.lines.length + plan.freeText.length;
  const empty = needed === 0;
  const items: ShopItemView[] =
    shop?.items.map((i) => ({
      id: i.id,
      text: i.display || i.note,
      checked: i.checked,
      label: i.label,
      position: i.position,
    })) ?? [];
  const base = process.env.MEALIE_PUBLIC_URL?.replace(/\/$/, "");
  const nav = "rounded-lg border border-border bg-card px-3 py-1.5 text-sm";

  return (
    <div className="space-y-4 pb-8">
      {sent && <AutoRefresh seconds={15} />}
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/week/${addDays(weekStart, -7)}/shopping`}
          className={nav}
          aria-label="Previous week"
        >
          ←
        </Link>
        <div className="text-center">
          <h1 className="font-semibold">
            Shopping · {formatRange(weekStart, addDays(weekStart, 6))}
          </h1>
          <Link href={`/week/${weekStart}`} className="text-xs text-accent">
            Back to the plan
          </Link>
        </div>
        <Link
          href={`/week/${addDays(weekStart, 7)}/shopping`}
          className={nav}
          aria-label="Next week"
        >
          →
        </Link>
      </div>

      {mealieDown && (
        <p role="alert" className="text-sm text-danger">
          Mealie isn&apos;t reachable right now, so the list can&apos;t load.
          Try again in a moment.
        </p>
      )}

      {(plan.missing.length > 0 || plan.unscaled.length > 0) && (
        <div
          className="space-y-1 rounded-xl border border-danger p-3 text-sm"
          role="note"
        >
          {plan.missing.length > 0 && (
            <p>⚠ No longer in Mealie, left out: {plan.missing.join(", ")}.</p>
          )}
          {plan.unscaled.length > 0 && (
            <p>
              ⚠ No servings count in Mealie, so amounts are for the whole
              recipe: {plan.unscaled.join(", ")}. Set servings in Mealie to
              scale them.
            </p>
          )}
        </div>
      )}

      {shop && (
        <ShopChecklist
          weekStart={weekStart}
          listId={shop.listId}
          items={items}
        />
      )}

      {!sent && <Preview list={plan} />}

      <PushButton weekStart={weekStart} disabled={empty} pushedBefore={sent} />

      {sent && (
        <details className="rounded-xl border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            What the plan needs ({needed} item{needed === 1 ? "" : "s"})
          </summary>
          <div className="mt-3 space-y-4">
            <Preview list={plan} />
          </div>
        </details>
      )}

      {shop && base && (
        <p className="text-center text-xs text-muted">
          <a
            href={`${base}/shopping-lists/${shop.listId}`}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Open “{shop.listName}” in Mealie
          </a>
        </p>
      )}
      {pushed && sent && (
        <p className="text-center text-xs text-muted">
          Last sent{" "}
          {pushed.pushedAt.toISOString().slice(0, 16).replace("T", " ")} UTC
        </p>
      )}
    </div>
  );
}
