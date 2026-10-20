"use client";

import { useId, useOptimistic, useState, useTransition } from "react";
import { Ellipsis, Trash2 } from "lucide-react";

import {
  removeMealAction,
  setPortionAction,
  setServingsAction,
} from "@/app/(app)/week/actions";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { RecipeImage } from "@/components/ui/recipe-image";
import { cx } from "@/lib/cx";
import type { Member, PlannedMeal } from "@/server/plan";

import { RecipeFlags } from "./recipe-flags";
import { Stepper } from "./stepper";

/**
 * A meal on the Plan page: everyone's portion, one person per row so it fits a
 * day column; servings and Remove sit behind the options button, as on the
 * Week page.
 */
export const PlanMeal = ({
  meal,
  members,
}: {
  meal: PlannedMeal;
  members: Member[];
}) => {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(false);
  const servingsId = useId();
  const [portions, setOptimisticPortion] = useOptimistic(
    meal.portions,
    (
      current,
      { userId, multiplier }: { userId: string; multiplier: number }
    ) => ({ ...current, [userId]: multiplier })
  );

  const act = (work: () => Promise<{ error?: string }>) =>
    startTransition(async () => {
      setError(undefined);
      const res = await work();
      if (res.error) {
        setError(res.error);
      }
    });

  const name = meal.recipe?.name ?? meal.slug;
  const photo = meal.recipe?.imagePath ? meal.recipe.mealieId : null;

  return (
    <li
      className={cx(
        "space-y-2 rounded-control border border-border/70 bg-background p-2.5",
        pending && "opacity-70"
      )}
      data-testid="meal"
    >
      <div className="flex items-start gap-2.5">
        <RecipeImage mealieId={photo} className="size-11" />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 font-serif text-[0.9375rem] leading-snug font-semibold">
            {name}
          </p>
          <RecipeFlags recipe={meal.recipe} slug={meal.slug} />
        </div>
        <IconButton
          label={`Options for ${name}`}
          aria-expanded={open}
          className="-mt-1.5 -mr-1.5"
          onClick={() => setOpen((o) => !o)}
        >
          <Ellipsis className="size-5" aria-hidden />
        </IconButton>
      </div>

      <div className="space-y-1">
        {members.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-2">
            <span aria-hidden className="min-w-0 truncate text-sm text-muted">
              {m.name}
            </span>
            <Stepper
              label={`${m.name}'s portion of ${name}`}
              value={portions[m.id] ?? 0}
              onChange={(multiplier) =>
                act(async () => {
                  setOptimisticPortion({ userId: m.id, multiplier });
                  return setPortionAction({
                    mealId: meal.id,
                    userId: m.id,
                    multiplier,
                  });
                })
              }
            />
          </div>
        ))}
      </div>

      {open && (
        <div className="space-y-3 rounded-control bg-sunken p-2.5 text-sm">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={servingsId} className="text-muted">
              Servings per 1×
            </label>
            <Input
              id={servingsId}
              type="number"
              min="0.25"
              max="100"
              step="0.25"
              defaultValue={meal.baseServings}
              className="w-20 tabular-nums"
              onBlur={(e) => {
                const baseServings = Number(e.currentTarget.value);
                if (baseServings > 0 && baseServings !== meal.baseServings) {
                  act(() =>
                    setServingsAction({ mealId: meal.id, baseServings })
                  );
                }
              }}
            />
          </div>
          <Button
            variant="danger"
            size="sm"
            block
            onClick={() => act(() => removeMealAction({ mealId: meal.id }))}
          >
            <Trash2 className="size-4" aria-hidden />
            Remove
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </li>
  );
};
