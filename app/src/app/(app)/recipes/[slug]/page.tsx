import { Suspense } from "react";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";

import { RecipeFlags } from "@/components/plan/recipe-flags";
import { EditInMealie } from "@/components/recipe/edit-in-mealie";
import {
  NutritionGrid,
  RecipeFacts,
  RecipeNotes,
} from "@/components/recipe/recipe-details";
import { RecipeImage } from "@/components/ui/recipe-image";
import { formatPortion } from "@/lib/format";
import { getDb } from "@/server/db/client";
import { recipeSlug } from "@/server/domain/recipe-slug";
import { daySlots } from "@/server/domain/slots";
import { slotFromTags } from "@/server/domain/taxonomy";
import { getSnackSlots } from "@/server/household";
import { loadRecipes } from "@/server/recipe-cache";
import { requireUser } from "@/server/session";
import { viewerToday } from "@/server/today";

import { AddToPlan } from "./add-to-plan";
import { RecipeCooking } from "./recipe-cooking";

/**
 * A recipe outside the plan, opened from Discover: the same view as a
 * planned meal's page, with a way to put it in the plan. It reads through
 * the recipe cache, so it opens while Mealie is down once it has been seen.
 */
export default async function RecipePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await requireUser();
  const { slug } = await params;
  if (!recipeSlug.safeParse(slug).success) {
    notFound();
  }
  const db = getDb();
  const [cached, snackSlots, today] = await Promise.all([
    loadRecipes(db, [slug], { defer: after }),
    getSnackSlots(db),
    viewerToday(),
  ]);
  let recipe = cached.get(slug) ?? null;
  if (recipe && (recipe.instructions === null || recipe.tags === null)) {
    // Cached before the cache kept these: fetch them now, or show the rest
    // of the recipe while Mealie can't be reached.
    recipe = await loadRecipes(db, [slug], { force: true })
      .then((fresh) => fresh.get(slug) ?? null)
      .catch((err: unknown) => {
        console.warn(`recipe ${slug}: refresh for the recipe page failed`, err);
        return recipe;
      });
  }
  if (!recipe) {
    notFound();
  }

  const slots = daySlots(snackSlots)
    .filter((s) => s.active)
    .map(({ slot, snackIndex, label }) => ({ slot, snackIndex, label }));
  const suggestedSlot = slotFromTags((recipe.tags ?? []).map((t) => t.slug));
  // A snack recipe goes in the day's first snack slot.
  const suggested = slots.find((s) => s.slot === suggestedSlot) ?? null;

  return (
    <article className="space-y-5 pb-8">
      <Link
        href="/recipes"
        className="-ml-1 inline-flex min-h-tap items-center gap-1 text-sm font-medium text-accent-ink"
      >
        <ChevronLeft className="size-4" aria-hidden />
        All recipes
      </Link>

      <header className="space-y-3">
        {recipe.imagePath && (
          <RecipeImage
            mealieId={recipe.mealieId}
            className="aspect-[16/9] w-full sm:aspect-[21/9]"
            rounded="rounded-card"
          />
        )}
        <h1 className="font-serif text-title font-semibold sm:text-display">
          {recipe.name}
        </h1>
        {recipe.servings && (
          <p className="text-sm text-muted">
            Recipe makes {formatPortion(recipe.servings)} serving
            {recipe.servings === 1 ? "" : "s"}
          </p>
        )}
        <RecipeFlags recipe={recipe} slug={recipe.slug} />
        <RecipeFacts
          totalMinutes={recipe.totalMinutes}
          categories={recipe.categories}
          tags={recipe.tags}
        />
        <NutritionGrid nutrition={recipe.nutrition} />
        <AddToPlan
          slug={recipe.slug}
          name={recipe.name}
          today={today}
          slots={slots}
          suggested={suggested}
        />
      </header>

      <RecipeCooking
        servings={recipe.servings}
        ingredients={recipe.ingredients}
        instructions={recipe.instructions ?? []}
      />

      <RecipeNotes notes={recipe.notes ?? []} />

      <Suspense fallback={null}>
        <EditInMealie slug={recipe.slug} />
      </Suspense>
    </article>
  );
}
