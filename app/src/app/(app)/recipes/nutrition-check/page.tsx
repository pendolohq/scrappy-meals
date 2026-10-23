import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";

import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Pill, type PillTone } from "@/components/ui/pill";
import { getDb } from "@/server/db/client";
import type { CheckStatus } from "@/server/domain/usda-check";
import { requireUser } from "@/server/session";
import {
  CHECK_GROUPS,
  type CheckedRecipe,
  loadOverview,
} from "@/server/usda/check";
import { usdaEnabled } from "@/server/usda/client";

import { MACRO_LABELS } from "./labels";

const GROUPS: Record<
  CheckStatus,
  { title: string; hint: string; tone: PillTone }
> = {
  mismatch: {
    title: "Mismatch",
    hint: "Mealie's figures are further from USDA's than they should be.",
    tone: "danger",
  },
  cantCheck: {
    title: "Can't check yet",
    hint: "Something is missing before the ingredients can be added up.",
    tone: "highlight",
  },
  reviewed: {
    title: "Reviewed",
    hint: "Decided already; they come back if the ingredients or matches change.",
    tone: "accent",
  },
  match: {
    title: "Matches",
    hint: "Mealie and USDA agree.",
    tone: "neutral",
  },
};

const detail = ({ check }: CheckedRecipe): string => {
  if (check.status === "cantCheck") {
    const parts = [];
    if (check.noServings) {
      parts.push("no servings");
    }
    if (check.nothingToCount) {
      parts.push("no ingredients to count");
    }
    if (check.unmatchedFoods.length > 0) {
      parts.push(
        `${check.unmatchedFoods.length} ${check.unmatchedFoods.length === 1 ? "food" : "foods"} to match`
      );
    }
    if (check.needsAmount.length > 0) {
      parts.push(
        `${check.needsAmount.length} ${check.needsAmount.length === 1 ? "line needs" : "lines need"} an amount`
      );
    }
    return parts.join(", ");
  }
  return check.outside.length > 0
    ? `Outside: ${check.outside.map((m) => MACRO_LABELS[m].toLowerCase()).join(", ")}`
    : "";
};

export default async function NutritionCheckPage() {
  await requireUser();
  if (!usdaEnabled()) {
    notFound();
  }
  const { recipes, foods } = await loadOverview(getDb(), after);
  const toMatch = foods.filter((f) => !f.match).length;
  const suggested = foods.filter((f) => f.match?.status === "suggested").length;

  return (
    <section className="space-y-6 pb-8">
      <PageHeader
        title="Check against USDA"
        description="Adds up each recipe's ingredients in USDA FoodData Central and compares the result with the nutrition in Mealie."
        actions={
          <Link
            href="/recipes/nutrition-check/foods"
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            Match foods
          </Link>
        }
      />
      <p className="text-sm text-muted">
        {toMatch + suggested === 0
          ? "Every food is matched."
          : `${toMatch} ${toMatch === 1 ? "food" : "foods"} to match${suggested > 0 ? `, ${suggested} suggested` : ""}.`}
      </p>

      {CHECK_GROUPS.map((status) => {
        const group = GROUPS[status];
        const items = recipes.filter((r) => r.check.status === status);
        return (
          <Card
            key={status}
            as="section"
            aria-labelledby={`group-${status}`}
            className="space-y-3"
          >
            <div className="space-y-1">
              <h2
                id={`group-${status}`}
                className="flex items-center gap-2 font-serif text-lg font-semibold"
              >
                {group.title}
                <Pill tone={group.tone}>{items.length}</Pill>
              </h2>
              <p className="text-sm text-muted">{group.hint}</p>
            </div>
            {items.length > 0 && (
              <ul className="divide-y divide-border/70">
                {items.map((r) => (
                  <li key={r.slug}>
                    <Link
                      href={`/recipes/nutrition-check/${r.slug}`}
                      className="flex min-h-tap flex-col justify-center py-2 hover:text-accent-ink"
                    >
                      <span className="font-medium">{r.name}</span>
                      {detail(r) && (
                        <span className="text-sm text-muted">{detail(r)}</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </section>
  );
}
