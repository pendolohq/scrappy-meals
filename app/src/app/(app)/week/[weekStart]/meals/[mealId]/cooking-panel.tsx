"use client";

import { useOptimistic, useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";

import { setPortionAction } from "@/app/(app)/week/actions";
import { Stepper } from "@/components/plan/stepper";
import { IngredientsCard } from "@/components/recipe/ingredients-card";
import { Method } from "@/components/recipe/method";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cx } from "@/lib/cx";
import { formatPortion } from "@/lib/format";
import { plannedServings, scaleIngredients } from "@/server/domain/ingredients";
import type { Ingredient, RecipeStep } from "@/server/mealie/recipes";

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-xs font-semibold tracking-wider text-muted uppercase">
    {children}
  </h2>
);

/**
 * Everyone's portions, which are saved to the plan, and the ingredients for
 * "cooking for", which is only a view: changing it never touches the plan,
 * so batch cooking doesn't put wrong numbers into anyone's totals. The
 * method is here too because its steps show their ingredients in the same
 * amounts.
 */
export const CookingPanel = ({
  mealId,
  mealName,
  members,
  portions: savedPortions,
  baseServings,
  recipe,
}: {
  mealId: string;
  mealName: string;
  members: { id: string; name: string }[];
  portions: Record<string, number>;
  baseServings: number;
  /** Null when the recipe isn't in Mealie (or Mealie is down and nothing is cached). */
  recipe: {
    servings: number | null;
    ingredients: Ingredient[];
    instructions: RecipeStep[];
  } | null;
}) => {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [portions, setOptimisticPortion] = useOptimistic(
    savedPortions,
    (
      current,
      { userId, multiplier }: { userId: string; multiplier: number }
    ) => ({ ...current, [userId]: multiplier })
  );
  // Null follows the plan; set once someone touches the stepper.
  const [cookingFor, setCookingFor] = useState<number | null>(null);

  const planned = plannedServings(baseServings, portions);
  // Nobody eating it still leaves a recipe worth reading, so show it for one
  // rather than a list of zeros.
  const fromPlan = planned > 0 ? planned : 1;
  const servings = cookingFor ?? fromPlan;
  const lines = recipe
    ? scaleIngredients(recipe.ingredients, recipe.servings, servings)
    : [];

  const setPortion = (userId: string, multiplier: number) =>
    startTransition(async () => {
      setError(undefined);
      setOptimisticPortion({ userId, multiplier });
      const res = await setPortionAction({ mealId, userId, multiplier });
      if (res.error) {
        setError(res.error);
      }
    });

  return (
    <>
      <Card as="section" aria-labelledby="portions">
        <div id="portions">
          <SectionTitle>Portions in the plan</SectionTitle>
        </div>
        <p className="mt-1 text-xs text-muted">
          Saved to the plan: everyone&apos;s totals and the shopping list
          follow.
        </p>
        <ul
          className={cx(
            "mt-2 divide-y divide-border/70",
            pending && "opacity-70"
          )}
        >
          {members.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-3 py-2"
            >
              <span className="min-w-0 truncate font-medium">{m.name}</span>
              <Stepper
                label={`${m.name}'s portion of ${mealName}`}
                value={portions[m.id] ?? 0}
                onChange={(multiplier) => setPortion(m.id, multiplier)}
              />
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {error}
          </p>
        )}
      </Card>

      {recipe && (
        <IngredientsCard
          recipeServings={recipe.servings}
          lines={lines}
          cookingFor={servings}
          onCookingFor={setCookingFor}
          caption={
            <>
              <span>
                {cookingFor !== null
                  ? "Only this list changes, not the plan."
                  : planned > 0
                    ? `The plan's ${formatPortion(planned)} serving${planned === 1 ? "" : "s"}.`
                    : "Nobody eats this in the plan; shown for 1."}
              </span>
              {cookingFor !== null && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCookingFor(null)}
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                  Reset to plan ({formatPortion(fromPlan)})
                </Button>
              )}
            </>
          }
        />
      )}

      {recipe && recipe.instructions.length > 0 && (
        <Method steps={recipe.instructions} lines={lines} />
      )}
    </>
  );
};
