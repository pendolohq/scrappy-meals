"use client";

import { useState, useTransition } from "react";

import { addMealAction } from "@/app/(app)/week/actions";
import { Button } from "@/components/ui/button";
import { servingsFor } from "@/server/domain/product";
import type { KnownProduct } from "@/server/products";

import { attempt, failureText } from "../attempt";

import { AlreadyHad } from "./already-had";
import { nutritionLine, scaled } from "./nutrition";
import {
  choiceOf,
  type PortionKind,
  PortionPicker,
  usable,
} from "./portion-picker";
import type { SheetProps } from "./sheet-props";

/** A product Mealie already has: its nutrition as saved, and how much to add. */
export const KnownSheet = ({
  lookup,
  at,
  future,
  onAdded,
  onBack,
}: SheetProps & { lookup: KnownProduct }) => {
  const [picked, setKind] = useState<PortionKind>("one");
  const [grams, setGrams] = useState("");
  const [alreadyHad, setAlreadyHad] = useState(!future);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const kind = usable(picked, lookup.info);
  const baseServings = servingsFor(choiceOf(kind, grams), lookup.info);

  const add = () =>
    startTransition(async () => {
      setError(undefined);
      if (baseServings === null) {
        return;
      }
      const res = await attempt(() =>
        addMealAction({
          ...at,
          slug: lookup.slug,
          baseServings,
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
        <h3 className="font-serif text-lg font-semibold">{lookup.name}</h3>
        <p className="text-sm text-muted tabular-nums">
          {nutritionLine("Per serving", lookup.nutrition.perServing)}
        </p>
      </div>
      <PortionPicker
        info={lookup.info}
        unit={lookup.info.servingUnit}
        kind={kind}
        onKind={setKind}
        grams={grams}
        onGrams={setGrams}
      />
      {baseServings !== null && (
        <p className="text-sm text-muted tabular-nums" aria-live="polite">
          {nutritionLine(
            "This portion",
            scaled(lookup.nutrition.perServing, baseServings)
          )}
        </p>
      )}
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
        <Button block disabled={pending || baseServings === null} onClick={add}>
          {pending ? "Adding…" : "Add"}
        </Button>
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
  );
};
