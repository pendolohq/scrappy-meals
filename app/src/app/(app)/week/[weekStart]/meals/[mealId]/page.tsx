import { Suspense } from "react";
import { ChevronLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";

import { RecipeFlags } from "@/components/plan/recipe-flags";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RecipeImage } from "@/components/ui/recipe-image";
import { formatAmount, formatDay, formatPortion } from "@/lib/format";
import { getDb } from "@/server/db/client";
import { slotLabel } from "@/server/domain/slots";
import { weekStartOf } from "@/server/domain/week";
import { recipeLinkInMealie } from "@/server/mealie/links";
import { MACRO_KEYS, type MacroKey } from "@/server/mealie/nutrition";
import type { RecipeStep } from "@/server/mealie/recipes";
import { getMeal } from "@/server/plan";
import { requireUser } from "@/server/session";

import { canonicalWeek } from "../../../week-route";

import { CookingPanel } from "./cooking-panel";

const MACRO_LABEL: Record<MacroKey, string> = {
  kcal: "kcal",
  protein: "Protein",
  carbs: "Carbs",
  fat: "Fat",
  fibre: "Fibre",
};

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">
    {children}
  </h2>
);

/**
 * The recipe's page in Mealie, for people with a Mealie account. Its URL
 * needs the group's slug, so it streams in after the page: a Mealie that's
 * down doesn't hold up the recipe, it only leaves out the link.
 */
const EditInMealie = async ({ slug }: { slug: string }) => {
  const href = await recipeLinkInMealie(slug);
  if (!href) {
    return null;
  }
  return (
    <p className="text-center">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonClass({ variant: "secondary", size: "sm" })}
      >
        Edit in Mealie
        <ExternalLink className="size-3.5" aria-hidden />
      </a>
    </p>
  );
};

/** Headings aren't steps: only steps with text get a number. */
const numberSteps = (steps: RecipeStep[]) => {
  let count = 0;
  return steps.map((step) => ({
    ...step,
    number: step.text ? (count += 1) : null,
  }));
};

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
  const instructions = numberSteps(recipe?.instructions ?? []);
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
          <dl
            className="grid grid-cols-5 gap-2 rounded-control bg-sunken/70 p-3 text-center tabular-nums"
            aria-label="Nutrition per serving"
            data-testid="nutrition"
          >
            {MACRO_KEYS.map((key) => {
              const value = recipe.nutrition.perServing[key];
              return (
                <div key={key} className="min-w-0">
                  <dt className="truncate text-xs text-muted">
                    {MACRO_LABEL[key]}
                  </dt>
                  <dd className="font-semibold">
                    {value === undefined
                      ? "–"
                      : `${formatAmount(value)}${key === "kcal" ? "" : " g"}`}
                  </dd>
                </div>
              );
            })}
            <p className="col-span-5 text-xs text-muted">Per serving</p>
          </dl>
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
          }
        }
      />

      {instructions.length > 0 && (
        <Card as="section">
          <SectionTitle>Method</SectionTitle>
          <ol className="space-y-3" data-testid="instructions">
            {instructions.map((step, i) => (
              <li key={i}>
                {step.title && (
                  <h3 className="pt-2 pb-1 font-serif font-semibold">
                    {step.title}
                  </h3>
                )}
                {step.text && (
                  <div className="flex gap-3">
                    <span
                      aria-hidden
                      className="w-5 shrink-0 font-semibold text-accent-ink tabular-nums"
                    >
                      {step.number}
                    </span>
                    <p className="min-w-0 whitespace-pre-line">{step.text}</p>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}

      {notes.length > 0 && (
        <Card as="section">
          <SectionTitle>Notes</SectionTitle>
          <div className="space-y-3">
            {notes.map((note, i) => (
              <div key={i}>
                {note.title && <h3 className="font-semibold">{note.title}</h3>}
                {note.text && (
                  <p className="whitespace-pre-line">{note.text}</p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {recipe && (
        <Suspense fallback={null}>
          <EditInMealie slug={recipe.slug} />
        </Suspense>
      )}
    </article>
  );
}
