import Link from "next/link";
import { redirect } from "next/navigation";

import { AutoRefresh } from "@/components/auto-refresh";
import { formatRange } from "@/lib/format";
import type { ShopItemView } from "@/lib/shop-list";
import { getDb } from "@/server/db/client";
import { addDays, isIsoDate, weekStartOf } from "@/server/domain/week";
import { isMealieUnavailable } from "@/server/mealie/client";
import { requireUser } from "@/server/session";
import { type ShopList, weekShopList } from "@/server/shopping";

import { ShopChecklist } from "./shop-checklist";

export const dynamic = "force-dynamic";

export default async function ShopPage({
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
    redirect(`/week/${weekStartOf(weekStart)}/shop`);
  }

  let list: ShopList | null = null;
  let mealieDown = false;
  try {
    list = await weekShopList(getDb(), weekStart);
  } catch (err) {
    if (!isMealieUnavailable(err)) {
      throw err;
    }
    mealieDown = true;
  }
  const items: ShopItemView[] =
    list?.items.map((i) => ({
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
      <AutoRefresh seconds={15} />
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/week/${addDays(weekStart, -7)}/shop`}
          className={nav}
          aria-label="Previous week"
        >
          ←
        </Link>
        <div className="text-center">
          <h1 className="font-semibold">
            Shop · {formatRange(weekStart, addDays(weekStart, 6))}
          </h1>
          <Link
            href={`/week/${weekStart}/shopping`}
            className="text-xs text-accent"
          >
            Back to the list builder
          </Link>
        </div>
        <Link
          href={`/week/${addDays(weekStart, 7)}/shop`}
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
      {!mealieDown && !list && (
        <p className="text-sm text-muted">
          No list for this week yet.{" "}
          <Link
            href={`/week/${weekStart}/shopping`}
            className="text-accent underline"
          >
            Build it and send it to Mealie
          </Link>{" "}
          first.
        </p>
      )}
      {list && (
        <>
          <ShopChecklist
            weekStart={weekStart}
            listId={list.listId}
            items={items}
          />
          {base && (
            <p className="text-center text-xs text-muted">
              <a
                href={`${base}/shopping-lists/${list.listId}`}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Open “{list.listName}” in Mealie
              </a>
            </p>
          )}
        </>
      )}
    </div>
  );
}
