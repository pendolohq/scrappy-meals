"use client";

import { useId, useOptimistic, useState, useTransition } from "react";
import { Ellipsis, Minus, Plus, Trash2 } from "lucide-react";
import Link from "next/link";

import {
  removeMealAction,
  setPortionAction,
  setServingsAction,
} from "@/app/(app)/week/actions";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { pillClass } from "@/components/ui/pill";
import { RecipeImage } from "@/components/ui/recipe-image";
import { cx } from "@/lib/cx";
import { formatPortion } from "@/lib/format";
import type { Member, PlannedMeal } from "@/server/plan";

import { AdherenceBadge, AdherenceButtons } from "./adherence-cell";

const STEP = 0.25;

const Flags = ({ meal }: { meal: PlannedMeal }) => {
  const flags: string[] = [];
  if (!meal.recipe) {
    flags.push("Not found in Mealie");
  } else {
    if (meal.recipe.nutrition.status === "missing") {
      flags.push("No nutrition data");
    }
    if (meal.recipe.nutrition.status === "partial") {
      flags.push(`No ${meal.recipe.nutrition.missing.join(", ")} data`);
    }
    if (!meal.recipe.servings) {
      flags.push("No servings count in Mealie");
    }
  }
  const estimated = meal.recipe?.nutritionSource === "estimated";
  const needsReview = meal.recipe?.reviewState === "pending";
  if (flags.length === 0 && !estimated && !needsReview) {
    return null;
  }
  return (
    <ul className="mt-1.5 flex flex-wrap gap-1.5">
      {flags.map((f) => (
        <li key={f} className={pillClass("danger")}>
          ⚠ {f}
        </li>
      ))}
      {estimated && <li className={pillClass()}>≈ Estimated nutrition</li>}
      {needsReview && (
        <li className="-my-2 flex min-h-tap items-center">
          <Link
            href={reviewHref(meal.slug)}
            className={cx(
              pillClass("highlight"),
              "underline-offset-2 hover:underline"
            )}
          >
            Needs review
          </Link>
        </li>
      )}
    </ul>
  );
};

const reviewHref = (slug: string) =>
  `/recipes/${encodeURIComponent(slug)}/review`;

const Stepper = ({
  label,
  value,
  onChange,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
}) => {
  const btn =
    "flex size-tap items-center justify-center rounded-full border border-border-strong bg-card text-foreground transition hover:bg-sunken disabled:opacity-40";
  return (
    <fieldset
      className="flex min-w-0 items-center justify-center gap-1"
      aria-label={label}
    >
      <button
        type="button"
        className={btn}
        aria-label={`Less (${label})`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - STEP))}
      >
        <Minus className="size-4" aria-hidden />
      </button>
      <span
        className={cx(
          "w-9 text-center text-[0.9375rem] font-semibold tabular-nums",
          value === 0 && "font-normal text-muted"
        )}
        data-testid="portion"
      >
        {formatPortion(value)}×
      </span>
      <button
        type="button"
        className={btn}
        aria-label={`More (${label})`}
        disabled={value >= 20}
        onClick={() => onChange(Math.min(20, value + STEP))}
      >
        <Plus className="size-4" aria-hidden />
      </button>
    </fieldset>
  );
};

export const MealRow = ({
  meal,
  members,
  currentUserId,
  canLog,
}: {
  meal: PlannedMeal;
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
                href={reviewHref(meal.slug)}
                className="underline-offset-2 hover:underline"
              >
                {name}
              </Link>
            ) : (
              name
            )}
          </p>
          <Flags meal={meal} />
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
            {members.length > 1 && (
              <p
                aria-hidden
                className="text-center text-[0.6875rem] font-medium tracking-wider text-muted uppercase"
              >
                {m.name}
              </p>
            )}
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
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-sunken p-3 text-sm">
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
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </li>
  );
};
