import { TriangleAlert } from "lucide-react";
import { after } from "next/server";

import { AutoRefresh } from "@/components/auto-refresh";
import { WeekHeader } from "@/components/week-header";
import { getDb } from "@/server/db/client";
import { requireUser } from "@/server/session";
import { weekShopList } from "@/server/shop";

import { canonicalWeek } from "../../week-route";

import { ShopChecklist } from "./shop-checklist";

export default async function ShoppingPage({
  params,
}: {
  params: Promise<{ weekStart: string }>;
}) {
  await requireUser();
  const weekStart = canonicalWeek((await params).weekStart, "shopping");

  const { plan, items } = await weekShopList(getDb(), weekStart, {
    defer: after,
  });

  return (
    <div className="space-y-5 pb-8">
      <AutoRefresh seconds={15} />
      <WeekHeader weekStart={weekStart} page="shopping" title="Shopping" />

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

      <ShopChecklist weekStart={weekStart} items={items} />
    </div>
  );
}
