import Link from "next/link";
import { redirect } from "next/navigation";

import { formatRange } from "@/lib/format";
import { getDb } from "@/server/db/client";
import { addDays, isIsoDate, weekStartOf } from "@/server/domain/week";
import { requireUser } from "@/server/session";
import { lastPush, weekShoppingList } from "@/server/shopping";

import { PushButton } from "./push-button";

export const dynamic = "force-dynamic";

const formatQty = (n: number) => String(Math.round(n * 100) / 100);

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
  const [list, pushed] = await Promise.all([
    weekShoppingList(db, weekStart),
    lastPush(db, weekStart),
  ]);
  const empty = list.lines.length === 0 && list.freeText.length === 0;
  const nav = "rounded-lg border border-border bg-card px-3 py-1.5 text-sm";

  return (
    <div className="space-y-4 pb-8">
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

      {(list.missing.length > 0 || list.unscaled.length > 0) && (
        <div
          className="space-y-1 rounded-xl border border-danger p-3 text-sm"
          role="note"
        >
          {list.missing.length > 0 && (
            <p>⚠ No longer in Mealie, left out: {list.missing.join(", ")}.</p>
          )}
          {list.unscaled.length > 0 && (
            <p>
              ⚠ No servings count in Mealie, so amounts are for the whole
              recipe: {list.unscaled.join(", ")}. Set servings in Mealie to
              scale them.
            </p>
          )}
        </div>
      )}

      {empty ? (
        <p className="text-sm text-muted">
          Nothing planned to eat this week yet.
        </p>
      ) : (
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
      )}

      <PushButton
        weekStart={weekStart}
        disabled={empty}
        pushedBefore={pushed !== null}
      />
      {pushed && (
        <>
          <Link
            href={`/week/${weekStart}/shop`}
            className="block rounded-lg border border-accent px-4 py-2 text-center font-medium text-accent"
          >
            Shop from this list
          </Link>
          <p className="text-center text-xs text-muted">
            Last sent{" "}
            {pushed.pushedAt.toISOString().slice(0, 16).replace("T", " ")} UTC
          </p>
        </>
      )}
    </div>
  );
}
