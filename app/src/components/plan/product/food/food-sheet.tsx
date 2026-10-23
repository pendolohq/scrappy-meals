"use client";

import { useState } from "react";

import { estimateNutritionAction } from "@/app/(app)/recipes/[slug]/review/actions";
import { saveFoodAction } from "@/app/(app)/week/actions";
import { Button } from "@/components/ui/button";
import { servingLabel } from "@/server/domain/food";
import type { KnownFood } from "@/server/foods";

import { attempt } from "../../attempt";
import { AlreadyHad } from "../already-had";
import { NoShopping } from "../no-shopping";
import { Notice } from "../notice";
import { nutritionLine } from "../nutrition";
import type { SheetProps } from "../sheet-props";

import {
  estimateLine,
  grams,
  lineFoodOf,
  matchWarning,
  nutritionToSave,
  readForm,
} from "./food-form";
import { MealieFoodOptions } from "./mealie-food-options";
import { NameSearch } from "./name-search";
import { OwnValuesFields } from "./own-values-fields";
import { ServingFields } from "./serving-fields";
import { SourceSummary } from "./source-summary";
import { UsdaSearch } from "./usda-search";
import { useFoodChoice } from "./use-food-choice";
import { useServingForm } from "./use-serving-form";
import { useSheetWork } from "./use-sheet-work";

/**
 * A food with no barcode, added by name: one added before, or a Mealie food
 * weighed through its USDA match (or Claude's estimate, or values typed in).
 */
export const FoodSheet = ({
  at,
  future,
  onAdded,
  onBack,
  onKnown,
}: SheetProps & {
  /** A food added before was picked: its own sheet takes over. */
  onKnown: (food: KnownFood) => void;
}) => {
  const work = useSheetWork();
  const form = useServingForm();
  const choice = useFoodChoice({ work, onKnown, onUsda: form.startPiece });
  const [alreadyHad, setAlreadyHad] = useState(!future);
  // Most foods added by name are bought out; fruit is unticked.
  const [noShopping, setNoShopping] = useState(true);

  const { found, picked, source } = choice;
  const { pending } = work;
  const { serving, piece, pieceOk, counted, own, ready } = readForm({
    picked,
    source,
    amount: form.amount,
    unit: form.unit,
    pieceText: form.pieceText,
    values: form.values,
  });
  const warning = matchWarning(picked, source, form.unit, piece);

  const estimate = () =>
    work.run(async () => {
      if (!serving || !picked) {
        return;
      }
      const food = lineFoodOf(picked);
      const res = await attempt(() =>
        estimateNutritionAction({
          name: choice.name.trim() || food.name,
          servings: 1,
          ingredients: [estimateLine(serving, piece, food)],
        })
      );
      if (res.error !== undefined) {
        work.fail(res);
      } else {
        form.takeEstimate(res.estimate.perServing);
      }
    });

  const save = () =>
    work.run(async () => {
      const nutrition =
        source && nutritionToSave(source, own.values, form.estimated);
      if (!ready || !picked || !serving || !nutrition) {
        return;
      }
      // A food counted by the piece is saved as one piece and planned as
      // that many servings, so adding it again starts from one.
      const pieces = serving.unit === "piece";
      const res = await attempt(() =>
        saveFoodAction({
          ...at,
          name: choice.name.trim() || (found?.name ?? ""),
          food:
            "food" in picked
              ? { id: picked.food.id }
              : { create: picked.create },
          serving: pieces ? { amount: 1, unit: "piece" } : serving,
          pieceGrams: pieces ? piece : null,
          pieceLabel: pieces ? form.pieceLabel : null,
          nutrition,
          noShopping,
          baseServings: pieces ? serving.amount : 1,
          alreadyHad: alreadyHad && !future,
        })
      );
      if (res.error !== undefined) {
        work.fail(res);
      } else {
        onAdded();
      }
    });

  return (
    <div className="space-y-5">
      <NameSearch
        name={choice.name}
        onName={choice.setName}
        searched={found !== undefined}
        recipes={found?.recipes ?? []}
        pending={pending}
        onFind={choice.find}
        onOpen={choice.openKnown}
      />

      {found && (
        <MealieFoodOptions found={found} picked={picked} onPick={choice.pick} />
      )}

      {found && picked && !source && (
        <UsdaSearch
          query={choice.query}
          onQuery={choice.setQuery}
          hits={choice.hits}
          pending={pending}
          estimating={found.estimating}
          onSearch={choice.searchUsda}
          onUse={choice.chooseHit}
          onSkip={choice.typeValues}
        />
      )}

      {picked && source && (
        <div className="space-y-4">
          <SourceSummary
            source={source}
            estimating={found?.estimating ?? false}
            canChange={found?.usda === true || source.kind === "usda"}
            onChange={choice.changeSource}
          />

          {warning && <Notice>{warning}</Notice>}

          <ServingFields
            form={form}
            source={source}
            amountOk={serving !== null}
            pieceOk={pieceOk}
          />

          {source.kind === "usda" && (
            <p className="text-sm text-muted tabular-nums" aria-live="polite">
              {counted === null || !pieceOk
                ? "Say how much to see its nutrition."
                : "problem" in counted
                  ? counted.problem === "no volume weight"
                    ? "USDA has no weight for a volume of this: give it in grams."
                    : "Pick or type what one piece weighs."
                  : `${nutritionLine("This serving", counted.perServing)} (${grams(counted.grams)} g)`}
            </p>
          )}

          {source.kind === "own" && (
            <OwnValuesFields
              servingName={serving && servingLabel({ ...serving, grams: null })}
              values={form.values}
              onValue={form.typeValue}
              estimated={form.estimated}
              estimating={found?.estimating ?? false}
              canEstimate={!pending && serving !== null && pieceOk}
              onEstimate={estimate}
            />
          )}

          <NoShopping checked={noShopping} onChange={setNoShopping} />
          <AlreadyHad
            checked={alreadyHad}
            future={future}
            onChange={setAlreadyHad}
          />
        </div>
      )}

      {work.error && (
        <p role="alert" className="text-sm text-danger">
          {work.error}
        </p>
      )}
      <div className="flex gap-2">
        {picked && source && (
          <Button block disabled={pending || !ready} onClick={save}>
            {pending ? "Adding…" : "Add"}
          </Button>
        )}
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
  );
};
