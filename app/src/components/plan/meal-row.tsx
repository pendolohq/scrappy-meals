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
import { Pill } from "@/components/ui/pill";
import { RecipeImage } from "@/components/ui/recipe-image";
import { cx } from "@/lib/cx";
import { formatPortion } from "@/lib/format";
import type { Member, PlannedMeal } from "@/server/plan";

import { AdherenceButtons, AdherenceMark } from "./adherence-cell";
import { RecipeFlags } from "./recipe-flags";
import { Stepper } from "./stepper";

export const MealRow = ({
  meal,
  members,
  weekStart,
  currentUserId,
  canLog,
  today,
}: {
  meal: PlannedMeal;
  /** The Monday of the meal's week, for the link to its recipe page. */
  weekStart: string;
  members: Member[];
  currentUserId: string;
  /** True from the meal's day onwards: adherence can't be logged in advance. */
  canLog: boolean;
  /** The viewer's today. */
  today: string;
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
  const ordered = [
    ...members.filter((m) => m.id === currentUserId),
    ...members.filter((m) => m.id !== currentUserId),
  ];
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

      {/* The viewer's log and portion; everyone else's portion stays in one
          short line, so a shared meal still reads as shared. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {meal.unplanned ? (
          <Pill>Unplanned</Pill>
        ) : (
          canLog && (
            <div className="w-full sm:w-52">
              <AdherenceButtons
                mealId={meal.id}
                mealName={name}
                log={meal.adherence[currentUserId]}
                at={meal}
                today={today}
                fill
              />
            </div>
          )
        )}
        <p className="text-xs text-muted tabular-nums" data-testid="portions">
          {ordered.map((m, i) => (
            <span key={m.id} className="whitespace-nowrap">
              {i > 0 && " · "}
              {members.length > 1 &&
                `${m.id === currentUserId ? "You" : m.name} `}
              <span
                data-testid="portion-text"
                className={cx(
                  m.id === currentUserId && "font-semibold text-foreground"
                )}
              >
                {formatPortion(portions[m.id] ?? 0)}×
              </span>
              {m.id !== currentUserId && (
                <AdherenceMark log={meal.adherence[m.id]} />
              )}
            </span>
          ))}
        </p>
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
                min="0.01"
                max="100"
                step="any"
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
