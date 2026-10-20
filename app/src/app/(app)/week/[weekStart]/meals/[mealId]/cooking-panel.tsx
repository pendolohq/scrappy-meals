"use client";

import { useOptimistic, useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";

import { setPortionAction } from "@/app/(app)/week/actions";
import { Stepper } from "@/components/plan/stepper";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cx } from "@/lib/cx";
import { formatPortion, formatQuantity } from "@/lib/format";
import { plannedServings, scaleIngredients } from "@/server/domain/ingredients";
import type { Ingredient } from "@/server/mealie/recipes";

const MAX_SERVINGS = 100;

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-xs font-semibold tracking-wider text-muted uppercase">
    {children}
  </h2>
);

/**
 * Everyone's portions, which are saved to the plan, and the ingredients for
 * "cooking for", which is only a view: changing it never touches the plan,
 * so batch cooking doesn't put wrong numbers into anyone's totals.
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
  recipe: { servings: number | null; ingredients: Ingredient[] } | null;
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
  const servings = cookingFor ?? planned;
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

  // Whole servings from wherever it stands: 1½ goes to 2 or 1.
  const stepCookingFor = (next: number) =>
    setCookingFor(
      Math.min(
        MAX_SERVINGS,
        Math.max(
          0,
          next > servings ? Math.floor(servings) + 1 : Math.ceil(servings) - 1
        )
      )
    );

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
        <Card as="section" aria-labelledby="ingredients">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div id="ingredients">
              <SectionTitle>Ingredients</SectionTitle>
            </div>
            {recipe.servings && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted">Cooking for</span>
                <Stepper
                  label="Cooking for"
                  value={servings}
                  onChange={stepCookingFor}
                  max={MAX_SERVINGS}
                  step={1}
                  suffix=""
                  testId="cooking-for"
                />
              </div>
            )}
          </div>
          {recipe.servings ? (
            <p className="mt-1 flex min-h-tap flex-wrap items-center gap-x-2 text-xs text-muted">
              <span>
                {cookingFor === null
                  ? `The plan's ${formatPortion(planned)} serving${planned === 1 ? "" : "s"}.`
                  : "Only this list changes, not the plan."}
              </span>
              {cookingFor !== null && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCookingFor(null)}
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                  Reset to plan ({formatPortion(planned)})
                </Button>
              )}
            </p>
          ) : (
            <p className="mt-2 rounded-control bg-danger-soft px-3 py-2 text-sm">
              No servings count in Mealie, so amounts are for the whole recipe.
              Set servings in Mealie to scale them.
            </p>
          )}
          {lines.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No ingredients in Mealie.</p>
          ) : (
            <ul className="mt-2 space-y-1" data-testid="ingredients">
              {lines.map((line, i) => (
                <li key={i}>
                  {line.title && (
                    <h3 className="pt-3 pb-1 font-serif font-semibold">
                      {line.title}
                    </h3>
                  )}
                  {line.scaled ? (
                    <p className="py-1">
                      <span
                        className="font-semibold text-accent-ink tabular-nums"
                        data-testid="qty"
                      >
                        {formatQuantity(line.scaled.quantity, line.scaled.unit)}
                      </span>{" "}
                      {line.scaled.food}
                      {line.scaled.note && (
                        <span className="text-muted">, {line.scaled.note}</span>
                      )}
                    </p>
                  ) : (
                    line.text && <p className="py-1">{line.text}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
};
