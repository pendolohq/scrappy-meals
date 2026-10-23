"use client";

import { useState, useTransition } from "react";

import { addMealAction } from "@/app/(app)/week/actions";
import { Button } from "@/components/ui/button";
import { servingLabel } from "@/server/domain/food";
import type { KnownFood } from "@/server/foods";

import { attempt, failureText } from "../attempt";
import { Stepper } from "../stepper";

import { AlreadyHad } from "./already-had";
import { nutritionLine, scaled } from "./nutrition";
import type { SheetProps } from "./sheet-props";

/** A single food added before: how many of its servings, and add. */
export const KnownFoodSheet = ({
  food,
  at,
  future,
  onAdded,
  onBack,
}: SheetProps & { food: KnownFood }) => {
  const [servings, setServings] = useState(1);
  const [alreadyHad, setAlreadyHad] = useState(!future);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const add = () =>
    startTransition(async () => {
      setError(undefined);
      const res = await attempt(() =>
        addMealAction({
          ...at,
          slug: food.slug,
          baseServings: servings,
          alreadyHad: alreadyHad && !future,
        })
      );
      if (res.error) {
        setError(failureText(res));
      } else {
        onAdded();
      }
    });

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-serif text-lg font-semibold">{food.name}</h3>
        <p className="text-sm text-muted tabular-nums">
          1 serving is {servingLabel(food.serving)}.{" "}
          {nutritionLine("Per serving", food.nutrition.perServing)}
        </p>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-muted">Servings</span>
        <Stepper
          label="Servings"
          value={servings}
          onChange={setServings}
          min={0.5}
          max={20}
          step={0.5}
          testId="food-servings"
        />
      </div>
      <p className="text-sm text-muted tabular-nums" aria-live="polite">
        {nutritionLine(
          "This portion",
          scaled(food.nutrition.perServing, servings)
        )}
      </p>
      <AlreadyHad
        checked={alreadyHad}
        future={future}
        onChange={setAlreadyHad}
      />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button block disabled={pending} onClick={add}>
          {pending ? "Adding…" : "Add"}
        </Button>
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
  );
};
