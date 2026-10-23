import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";

import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { getDb } from "@/server/db/client";
import { requireUser } from "@/server/session";
import { type FoodUsage, loadFoods } from "@/server/usda/check";
import { usdaEnabled } from "@/server/usda/client";
import { suggestingEnabled } from "@/server/usda/suggest";

import { FoodRow } from "./food-row";
import { SuggestButton } from "./suggest-button";

const Group = ({
  title,
  hint,
  foods,
  action,
}: {
  title: string;
  hint: string;
  foods: FoodUsage[];
  action?: React.ReactNode;
}) => (
  <section aria-label={title} className="space-y-3">
    <div className="flex items-end justify-between gap-3">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 font-serif text-lg font-semibold">
          {title}
          <Pill>{foods.length}</Pill>
        </h2>
        <p className="text-sm text-muted">{hint}</p>
      </div>
      {action}
    </div>
    <ul className="space-y-3">
      {foods.map((food) => (
        <li key={food.id}>
          <FoodRow
            food={{
              id: food.id,
              name: food.name,
              uses: food.uses,
              lines: food.lines,
            }}
            match={
              food.match && {
                status: food.match.status,
                fdcId: food.match.fdcId,
                description: food.match.food.description,
                dataType: food.match.food.dataType,
                kcalPer100g: food.match.food.per100g.kcal ?? null,
                portions: food.match.food.portions,
                pieceGrams: food.match.pieceGrams,
                pieceLabel: food.match.pieceLabel,
              }
            }
          />
        </li>
      ))}
    </ul>
  </section>
);

export default async function NutritionCheckFoodsPage() {
  await requireUser();
  if (!usdaEnabled()) {
    notFound();
  }
  const foods = await loadFoods(getDb(), after);
  const toMatch = foods.filter((f) => !f.match);
  const suggested = foods.filter((f) => f.match?.status === "suggested");
  const confirmed = foods.filter((f) => f.match?.status === "confirmed");

  return (
    <section className="space-y-8 pb-8">
      <PageHeader
        title="Match foods"
        description="Say which USDA food each ingredient is. A match counts for every recipe that uses the food."
        actions={
          <Link
            href="/recipes/nutrition-check"
            className={buttonClass({ variant: "ghost", size: "sm" })}
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back
          </Link>
        }
      />
      <Group
        title="To match"
        hint="Most-used first."
        foods={toMatch}
        action={
          toMatch.length > 0 && (
            <SuggestButton canSuggest={suggestingEnabled()} />
          )
        }
      />
      <Group
        title="Suggested"
        hint="Claude's pick from USDA's results. Confirm it, or search for another."
        foods={suggested}
      />
      <Group
        title="Confirmed"
        hint="Counted in the recipes' totals."
        foods={confirmed}
      />
    </section>
  );
}
