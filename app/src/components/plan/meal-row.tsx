"use client";

import { useId, useOptimistic, useState, useTransition } from "react";
import { Ellipsis, Trash2 } from "lucide-react";
import Link from "next/link";

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
import { formatPortion } from "@/lib/format";
import type { Member, PlannedMeal } from "@/server/plan";

import { AdherenceBadge, AdherenceButtons } from "./adherence-cell";
import { RecipeFlags } from "./recipe-flags";
import { Stepper } from "./stepper";

export const MealRow = ({
  meal,
  members,
  weekStart,
  currentUserId,
  canLog,
}: {
  meal: PlannedMeal;
  /** The Monday of the meal's week, for the link to its recipe page. */
  weekStart: string;
  members: Member[];
  currentUserId: string;
  /** True from the meal's day onwards: adherence can't be logged in advance. */
  canLog: boolean;
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
      className={cx("space-y-3 py-3", pending && "opacity-70")}
      data-testid="meal"
    >
      <div className="flex items-start gap-3">
        <RecipeImage mealieId={photo} className="size-16 sm:size-20" />
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="line-clamp-2 font-serif text-[1.0625rem] leading-snug font-semibold">
            {meal.recipe ? (
              <Link
                href={`/week/${weekStart}/meals/${meal.id}`}
                className="underline-offset-2 hover:underline"
              >
                {name}
              </Link>
            ) : (
              name
            )}
          </p>
          <RecipeFlags recipe={meal.recipe} slug={meal.slug} />
        </div>
        <IconButton
          label={`Options for ${name}`}
          aria-expanded={open}
          className="-mt-1 -mr-2"
          onClick={() => setOpen((o) => !o)}
        >
          <Ellipsis className="size-5" aria-hidden />
        </IconButton>
      </div>

      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: `repeat(${members.length}, minmax(0, 1fr))`,
        }}
      >
        {members.map((m) => (
          <div key={m.id} className="min-w-0 space-y-2">
            {/* Portions are nearly always 1×: shown as text, changed from the options. */}
            <p className="text-center text-[0.6875rem] font-medium tracking-wider text-muted uppercase tabular-nums">
              {members.length > 1 && `${m.name} · `}
              <span data-testid="portion-text">
                {formatPortion(portions[m.id] ?? 0)}×
              </span>
            </p>
            {m.id === currentUserId ? (
              canLog && (
                <AdherenceButtons
                  mealId={meal.id}
                  mealName={name}
                  log={meal.adherence[m.id]}
                />
              )
            ) : (
              <AdherenceBadge log={meal.adherence[m.id]} />
            )}
          </div>
        ))}
      </div>

      {open && (
        <div className="space-y-3 rounded-control bg-sunken p-3 text-sm">
          <div className="space-y-1">
            {members.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between gap-2"
              >
                <span aria-hidden className="min-w-0 truncate text-muted">
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
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
                className="w-24 tabular-nums"
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
              onClick={() => act(() => removeMealAction({ mealId: meal.id }))}
            >
              <Trash2 className="size-4" aria-hidden />
              Remove
            </Button>
          </div>
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
