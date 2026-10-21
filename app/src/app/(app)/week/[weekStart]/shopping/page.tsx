import { ChevronDown, ExternalLink, TriangleAlert } from "lucide-react";

import { AutoRefresh } from "@/components/auto-refresh";
import { Card, cardClass } from "@/components/ui/card";
import { WeekHeader } from "@/components/week-header";
import { cx } from "@/lib/cx";
import type { ShopItemView } from "@/lib/shop-list";
import { getDb } from "@/server/db/client";
import { AISLES } from "@/server/domain/aisles";
import {
  formatAmounts,
  formatProductLine,
  type WeekIngredients,
} from "@/server/domain/shopping";
import { isMealieUnavailable } from "@/server/mealie/client";
import { requireUser } from "@/server/session";
import { type ShopList, weekShopList } from "@/server/shop";
import { lastPush, weekShoppingList } from "@/server/shopping";

import { canonicalWeek } from "../../week-route";

import { PushButton } from "./push-button";
import { ShopChecklist } from "./shop-checklist";

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mb-1 text-xs font-semibold tracking-wider text-muted uppercase">
    {children}
  </h2>
);

const needed = (list: WeekIngredients) =>
  list.lines.length + list.products.length + list.freeText.length;

/** What the plan needs, as it will be sent to Mealie. */
const Preview = ({ list }: { list: WeekIngredients }) => {
  if (needed(list) === 0) {
    return (
      <Card className="py-10 text-center">
        <p className="font-serif text-heading font-semibold">
          Nothing to buy yet
        </p>
        <p className="mt-1 text-sm text-muted">
          Nothing planned to eat this week yet.
        </p>
      </Card>
    );
  }
  return (
    <>
      <div className="space-y-5" data-testid="lines">
        {AISLES.map((aisle) => {
          const lines = list.lines.filter((l) => l.aisle === aisle);
          if (lines.length === 0) {
            return null;
          }
          return (
            <Card as="section" key={aisle}>
              <SectionTitle>{aisle}</SectionTitle>
              <ul className="divide-y divide-border/70">
                {lines.map((l) => (
                  <li
                    key={l.key}
                    className="flex items-baseline justify-between gap-4 py-3"
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{l.foodName}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted">
                        {l.recipes.map((r) => r.name).join(", ")}
                      </span>
                    </span>
                    <span
                      className="shrink-0 text-right font-semibold text-accent-ink tabular-nums"
                      data-testid="qty"
                    >
                      {l.amounts.length === 0 ? "–" : formatAmounts(l.amounts)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>

      {list.products.length > 0 && (
        <Card as="section">
          <SectionTitle>Products</SectionTitle>
          <ul className="divide-y divide-border/70" data-testid="products">
            {list.products.map((p) => (
              <li key={p.recipeId} className="py-2.5 font-medium">
                {formatProductLine(p)}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {list.freeText.length > 0 && (
        <Card as="section">
          <SectionTitle>Check these</SectionTitle>
          <p className="mb-2 text-xs text-muted">
            Mealie hasn&apos;t parsed these lines, so they&apos;re added as
            written.
          </p>
          <ul className="divide-y divide-border/70" data-testid="free-text">
            {list.freeText.map((f, i) => (
              <li key={`${f.recipeId}-${i}`} className="py-2.5">
                {f.text}
                {f.times > 1 ? ` (×${f.times})` : ""}{" "}
                <span className="text-xs text-muted">· {f.recipeName}</span>
              </li>
            ))}
          </ul>
        </Card>
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
  const weekStart = canonicalWeek((await params).weekStart, "shopping");

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
  const count = needed(plan);
  const empty = count === 0;
  const items: ShopItemView[] =
    shop?.items.map((i) => ({
      id: i.id,
      text: i.display || i.note,
      checked: i.checked,
      label: i.label,
      position: i.position,
    })) ?? [];
  const base = process.env.MEALIE_PUBLIC_URL?.replace(/\/$/, "");

  return (
    <div className="space-y-5 pb-8">
      {sent && <AutoRefresh seconds={15} />}
      <WeekHeader weekStart={weekStart} page="shopping" title="Shopping" />

      {mealieDown && (
        <p
          role="alert"
          className="rounded-control bg-danger-soft px-4 py-3 text-sm font-medium text-danger"
        >
          Mealie isn&apos;t reachable right now, so the list can&apos;t load.
          Try again in a moment.
        </p>
      )}

      {(plan.missing.length > 0 || plan.unscaled.length > 0) && (
        <div
          className="flex gap-3 rounded-control bg-danger-soft px-4 py-3 text-sm"
          role="note"
        >
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0 text-danger"
            aria-hidden
          />
          <div className="space-y-1">
            {plan.missing.length > 0 && (
              <p>No longer in Mealie, left out: {plan.missing.join(", ")}.</p>
            )}
            {plan.unscaled.length > 0 && (
              <p>
                No servings count in Mealie, so amounts are for the whole
                recipe: {plan.unscaled.join(", ")}. Set servings in Mealie to
                scale them.
              </p>
            )}
          </div>
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
        <details className={cx(cardClass(), "group")}>
          <summary className="flex min-h-tap cursor-pointer list-none items-center justify-between text-sm font-medium [&::-webkit-details-marker]:hidden">
            What the plan needs ({count} item{count === 1 ? "" : "s"})
            <ChevronDown
              className="size-4 text-muted transition group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <div className="mt-3 space-y-4">
            <Preview list={plan} />
          </div>
        </details>
      )}

      {shop && base && (
        <p className="text-center text-sm">
          <a
            href={`${base}/shopping-lists/${shop.listId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-tap items-center gap-1.5 font-medium text-accent-ink underline-offset-2 hover:underline"
          >
            Open “{shop.listName}” in Mealie
            <ExternalLink className="size-3.5" aria-hidden />
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
