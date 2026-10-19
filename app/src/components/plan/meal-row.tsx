"use client";

import { useOptimistic, useState, useTransition } from "react";

import {
  removeMealAction,
  setPortionAction,
  setServingsAction,
} from "@/app/(app)/week/actions";
import { formatPortion } from "@/lib/format";

import { AdherenceBadge, AdherenceButtons } from "./adherence-cell";
import type { Member, PlannedMeal } from "@/server/plan";

const STEP = 0.25;

function Flags({ meal }: { meal: PlannedMeal }) {
  const flags: string[] = [];
  if (!meal.recipe) flags.push("Not found in Mealie");
  else {
    if (meal.recipe.nutrition.status === "missing")
      flags.push("No nutrition data");
    if (meal.recipe.nutrition.status === "partial")
      flags.push(`No ${meal.recipe.nutrition.missing.join(", ")} data`);
    if (!meal.recipe.servings) flags.push("No servings count in Mealie");
  }
  if (flags.length === 0) return null;
  return (
    <ul className="text-xs text-danger">
      {flags.map((f) => (
        <li key={f}>⚠ {f}</li>
      ))}
    </ul>
  );
}

function Stepper({
  label,
  value,
  onChange,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
}) {
  const btn =
    "h-8 w-8 rounded-full border border-border text-lg leading-none disabled:opacity-40";
  return (
    <div
      className="flex items-center justify-center gap-1.5"
      role="group"
      aria-label={label}
    >
      <button
        type="button"
        className={btn}
        aria-label={`Less (${label})`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - STEP))}
      >
        −
      </button>
      <span
        className={`w-9 text-center text-sm tabular-nums ${value === 0 ? "text-muted" : ""}`}
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
        +
      </button>
    </div>
  );
}

export function MealRow({
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
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(false);
  const [portions, setOptimisticPortion] = useOptimistic(
    meal.portions,
    (
      current,
      { userId, multiplier }: { userId: string; multiplier: number },
    ) => ({ ...current, [userId]: multiplier }),
  );

  const act = (work: () => Promise<{ error?: string }>) =>
    startTransition(async () => {
      setError(undefined);
      const res = await work();
      if (res.error) setError(res.error);
    });

  const name = meal.recipe?.name ?? meal.slug;
  const thumb = meal.recipe?.imagePath
    ? `/api/recipe-images/${meal.recipe.mealieId}`
    : null;

  return (
    <li
      className={`space-y-2 py-2 ${pending ? "opacity-70" : ""}`}
      data-testid="meal"
    >
      <div className="flex items-start gap-3">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element -- proxied Mealie thumbnails, already small
          <img
            src={thumb}
            alt=""
            className="h-10 w-10 shrink-0 rounded-md object-cover"
            loading="lazy"
          />
        ) : (
          <div
            className="h-10 w-10 shrink-0 rounded-md bg-border"
            aria-hidden
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{name}</p>
          <Flags meal={meal} />
        </div>
        <button
          type="button"
          className="px-1 text-muted"
          aria-expanded={open}
          aria-label={`Options for ${name}`}
          onClick={() => setOpen((o) => !o)}
        >
          ⋯
        </button>
      </div>

      <div
        className="grid gap-2"
        style={{
          gridTemplateColumns: `repeat(${members.length}, minmax(0, 1fr))`,
        }}
      >
        {members.map((m) => (
          <div key={m.id} className="space-y-1.5">
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
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-background p-2 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-muted">Servings per 1×</span>
            <input
              type="number"
              min="0.25"
              max="100"
              step="0.25"
              defaultValue={meal.baseServings}
              className="w-20 rounded border border-border bg-card px-2 py-1"
              onBlur={(e) => {
                const baseServings = Number(e.currentTarget.value);
                if (baseServings > 0 && baseServings !== meal.baseServings) {
                  act(() =>
                    setServingsAction({ mealId: meal.id, baseServings }),
                  );
                }
              }}
            />
          </label>
          <button
            type="button"
            className="text-danger"
            onClick={() => act(() => removeMealAction({ mealId: meal.id }))}
          >
            Remove
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
