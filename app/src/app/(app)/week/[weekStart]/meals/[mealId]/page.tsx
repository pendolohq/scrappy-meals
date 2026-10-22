import { Suspense } from "react";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";

import { RecipeFlags } from "@/components/plan/recipe-flags";
import { EditInMealie } from "@/components/recipe/edit-in-mealie";
import { OffContribution } from "@/components/recipe/off-contribution";
import {
  NutritionGrid,
  RecipeFacts,
  RecipeNotes,
} from "@/components/recipe/recipe-details";
import { RecipeImage } from "@/components/ui/recipe-image";
import { formatDay, formatPortion } from "@/lib/format";
import { getDb } from "@/server/db/client";
import { slotLabel } from "@/server/domain/slots";
import { weekStartOf } from "@/server/domain/week";
import { getMeal } from "@/server/plan";
import { requireUser } from "@/server/session";

import { canonicalWeek } from "../../../week-route";

import { CookingPanel } from "./cooking-panel";

export default async function MealPage({
  params,
}: {
  params: Promise<{ weekStart: string; mealId: string }>;
}) {
  await requireUser();
  const { weekStart: rawWeek, mealId } = await params;
  const weekStart = canonicalWeek(rawWeek, `meals/${mealId}`);
  if (!z.uuid().safeParse(mealId).success) {
    notFound();
  }
  const meal = await getMeal(getDb(), mealId, { defer: after });
  if (!meal) {
    notFound();
  }
  if (weekStartOf(meal.date) !== weekStart) {
    redirect(`/week/${weekStartOf(meal.date)}/meals/${meal.id}`);
  }
  const { recipe } = meal;
  const name = recipe?.name ?? meal.slug;
  const notes = recipe?.notes ?? [];

  return (
    <article className="space-y-5 pb-8">
      <Link
        href={`/week/${weekStart}#${meal.date}`}
        className="-ml-1 inline-flex min-h-tap items-center gap-1 text-sm font-medium text-accent-ink"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Back to the plan
      </Link>

      <header className="space-y-3">
        {recipe?.imagePath && (
          <RecipeImage
            mealieId={recipe.mealieId}
            className="aspect-[16/9] w-full sm:aspect-[21/9]"
            rounded="rounded-card"
          />
        )}
        <p className="text-xs font-semibold tracking-wider text-muted uppercase">
          {slotLabel(meal.slot, meal.snackIndex)} · {formatDay(meal.date)}
        </p>
        <h1 className="font-serif text-title font-semibold sm:text-display">
          {name}
        </h1>
        {recipe?.servings && (
          <p className="text-sm text-muted">
            Recipe makes {formatPortion(recipe.servings)} serving
            {recipe.servings === 1 ? "" : "s"}
          </p>
        )}
        <RecipeFlags recipe={recipe} slug={meal.slug} />
        {!recipe && (
          <p
            role="alert"
            className="rounded-control bg-danger-soft px-4 py-3 text-sm font-medium text-danger"
          >
            Mealie doesn&apos;t have this recipe, or isn&apos;t reachable right
            now. Portions can still be changed.
          </p>
        )}
        {recipe && (
          <RecipeFacts
            totalMinutes={recipe.totalMinutes}
            categories={recipe.categories}
            tags={recipe.tags}
          />
        )}
        {recipe && <NutritionGrid nutrition={recipe.nutrition} />}
        {recipe?.product && (
          <Suspense fallback={null}>
            <OffContribution barcode={recipe.product.barcode} />
          </Suspense>
        )}
      </header>

      <CookingPanel
        mealId={meal.id}
        mealName={name}
        members={meal.members.map((m) => ({ id: m.id, name: m.name }))}
        portions={meal.portions}
        baseServings={meal.baseServings}
        recipe={
          recipe && {
            servings: recipe.servings,
            ingredients: recipe.ingredients,
            instructions: recipe.instructions ?? [],
          }
        }
      />

      <RecipeNotes notes={notes} />

      {recipe && (
        <Suspense fallback={null}>
          <EditInMealie slug={recipe.slug} />
        </Suspense>
      )}
    </article>
  );
}
