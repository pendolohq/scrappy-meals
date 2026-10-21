"use client";

import { useId, useOptimistic, useState, useTransition } from "react";
import { ArrowRightLeft, Ellipsis, Trash2 } from "lucide-react";
import Link from "next/link";

import {
  moveMealAction,
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
import { weekStartOf } from "@/server/domain/week";
import type { Member, PlannedMeal } from "@/server/plan";

import { MoveMeal } from "./move-meal";
import { RecipeFlags } from "./recipe-flags";
import { Stepper } from "./stepper";

/**
 * A meal on the Plan page, with everyone's portions as a line of text; the
 * steppers, servings, Move and Remove sit behind the options button, as on
 * the Week page (which has no Move). `compact` is the desktop grid's cell: no photo, the name links
 * to the meal, and the options float over the grid.
 */
export const PlanMeal = ({
  meal,
  members,
  snackSlots,
  compact = false,
}: {
  meal: PlannedMeal;
  members: Member[];
  /** How many snack slots the household uses, for the Move picker. */
  snackSlots: number;
  compact?: boolean;
}) => {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
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

  // Portions are nearly always 1× each: the steppers wait behind the options
  // button, and the portions only show when someone's differs.
  const eating = members.filter((m) => (portions[m.id] ?? 0) > 0);
  const summary = members.every((m) => (portions[m.id] ?? 0) === 1)
    ? null
    : eating.length === 0
      ? "Nobody eats this"
      : eating
          .map((m) => `${m.name} ${formatPortion(portions[m.id])}×`)
          .join(" · ");

  const steppers = (
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
  );

  const options = open && (
    <div
      className={cx(
        "space-y-3 rounded-control bg-sunken p-2.5 text-sm",
        // A grid cell is too narrow for steppers: float over the grid instead.
        compact &&
          "absolute top-full right-0 z-10 mt-1 w-64 border border-border shadow-card"
      )}
    >
      {moving ? (
        <MoveMeal
          meal={meal}
          snackSlots={snackSlots}
          onCancel={() => setMoving(false)}
          onMove={(to) =>
            act(async () => {
              const res = await moveMealAction({ mealId: meal.id, ...to });
              if (!res.error) {
                setMoving(false);
              }
              return res;
            })
          }
        />
      ) : (
        <>
          {steppers}
          <div className="flex items-center justify-between gap-2">
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
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={() => setMoving(true)}
            >
              <ArrowRightLeft className="size-4" aria-hidden />
              Move
            </Button>
            <Button
              variant="danger"
              size="sm"
              className="flex-1"
              onClick={() => act(() => removeMealAction({ mealId: meal.id }))}
            >
              <Trash2 className="size-4" aria-hidden />
              Remove
            </Button>
          </div>
        </>
      )}
    </div>
  );

  const errorText = error && (
    <p role="alert" className="text-xs text-danger">
      {error}
    </p>
  );

  if (compact) {
    return (
      <li
        className={cx(
          "relative space-y-0.5 rounded-control border border-border/70 bg-card py-2 pr-2 pl-2.5 shadow-card",
          pending && "opacity-70"
        )}
        data-testid="grid-meal"
      >
        <div className="flex items-start gap-1">
          <Link
            href={`/week/${weekStartOf(meal.date)}/meals/${meal.id}`}
            className="line-clamp-2 min-w-0 flex-1 font-serif text-sm leading-snug font-semibold hover:text-accent-ink"
          >
            {name}
          </Link>
          <IconButton
            label={`Options for ${name}`}
            aria-expanded={open}
            className="-mt-1.5 -mr-1.5"
            onClick={() => setOpen((o) => !o)}
          >
            <Ellipsis className="size-4" aria-hidden />
          </IconButton>
        </div>
        {(meal.recipe?.product || meal.unplanned) && (
          <p className="flex flex-wrap gap-1">
            {meal.recipe?.product && <Pill tone="accent">Product</Pill>}
            {meal.unplanned && <Pill>Unplanned</Pill>}
          </p>
        )}
        {summary && (
          <p className="truncate text-xs text-muted tabular-nums">{summary}</p>
        )}
        {options}
        {errorText}
      </li>
    );
  }

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

      {meal.unplanned && <Pill>Unplanned</Pill>}
      {summary && <p className="text-xs text-muted tabular-nums">{summary}</p>}
      {options}
      {errorText}
    </li>
  );
};
