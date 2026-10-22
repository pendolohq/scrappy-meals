"use client";

import { useState, useTransition } from "react";

import { saveProductAction } from "@/app/(app)/week/actions";
import { Button } from "@/components/ui/button";
import { Field, Input, inputClass } from "@/components/ui/input";
import { cx } from "@/lib/cx";
import {
  perServing,
  type ProductDraft,
  type ProductInfo,
  type ServingUnit,
  servingsFor,
} from "@/server/domain/product";
import {
  MACRO_KEYS,
  type MacroKey,
  type Macros,
} from "@/server/mealie/nutrition";

import { attempt, failureText } from "../attempt";

import { AlreadyHad } from "./already-had";
import { Notice } from "./notice";
import { MACROS, nutritionLine } from "./nutrition";
import {
  choiceOf,
  type PortionKind,
  PortionPicker,
  usable,
} from "./portion-picker";
import type { SheetProps } from "./sheet-props";

const number = (text: string): number | undefined =>
  text.trim() === "" ? undefined : Number(text);

/**
 * A product to check before it is saved: from Open Food Facts (`draft`), or
 * empty to type in from the pack. Macros are per 100 g (or ml), as printed.
 */
export const DraftSheet = ({
  barcode,
  draft,
  at,
  future,
  onAdded,
  onBack,
}: SheetProps & { barcode: string; draft: ProductDraft | null }) => {
  const [name, setName] = useState(draft?.name ?? "");
  const [per100, setPer100] = useState<Record<MacroKey, string>>(
    () =>
      Object.fromEntries(
        MACRO_KEYS.map((k) => [k, String(draft?.per100[k] ?? "")])
      ) as Record<MacroKey, string>
  );
  const [serving, setServing] = useState(
    draft ? String(draft.servingGrams) : ""
  );
  const [unit, setUnit] = useState<ServingUnit>(draft?.servingUnit ?? "g");
  const [pack, setPack] = useState(
    draft?.packGrams ? String(draft.packGrams) : ""
  );
  const [picked, setKind] = useState<PortionKind>("one");
  const [grams, setGrams] = useState("");
  const [alreadyHad, setAlreadyHad] = useState(!future);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const values: Partial<Macros> = {};
  const outOfRange: Partial<Record<MacroKey, true>> = {};
  for (const key of MACRO_KEYS) {
    const v = number(per100[key]);
    if (v === undefined) {
      continue;
    }
    if (!(v >= 0 && v <= MACROS[key].max)) {
      outOfRange[key] = true;
    }
    values[key] = v;
  }
  const macrosValid = Object.keys(outOfRange).length === 0;
  const servingGrams = number(serving);
  const servingValid =
    servingGrams !== undefined && servingGrams >= 0.1 && servingGrams <= 5000;
  const packGrams = number(pack) ?? null;
  const packValid =
    packGrams === null || (packGrams >= 0.1 && packGrams <= 1e5);
  const info: ProductInfo | null =
    servingValid && packValid
      ? { barcode, servingGrams, servingUnit: unit, packGrams }
      : null;
  // Clearing the pack size after choosing "whole pack" falls back to a serving.
  const kind = usable(picked, info);
  const baseServings = info && servingsFor(choiceOf(kind, grams), info);
  const trimmed = name.trim();
  const ready =
    trimmed !== "" && macrosValid && info !== null && baseServings !== null;

  const save = () =>
    startTransition(async () => {
      setError(undefined);
      if (!info || baseServings === null) {
        return;
      }
      const res = await attempt(() =>
        saveProductAction({
          barcode,
          name: trimmed,
          servingGrams: info.servingGrams,
          servingUnit: unit,
          packGrams: info.packGrams,
          per100: values,
          fromOpenFoodFacts: draft !== null,
          imageUrl: draft?.imageUrl ?? null,
          edited:
            draft !== null &&
            MACRO_KEYS.some((k) => values[k] !== draft.per100[k]),
          ...at,
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
      {draft === null && (
        <Notice>Not on Open Food Facts yet: type it from the pack.</Notice>
      )}
      {draft && draft.missing.length === MACRO_KEYS.length && (
        <Notice>
          Open Food Facts has no nutrition for this: type it from the pack.
        </Notice>
      )}
      <div className="flex items-end gap-3">
        {draft?.imageUrl && (
          // oxlint-disable-next-line nextjs/no-img-element -- Open Food Facts' own photo, shown small while the product is checked
          <img
            src={draft.imageUrl}
            alt=""
            referrerPolicy="no-referrer"
            loading="lazy"
            className="size-16 shrink-0 rounded-control border border-border bg-sunken object-contain"
          />
        )}
        <div className="min-w-0 flex-1">
          <Field label="Name">
            <Input
              value={name}
              maxLength={120}
              required
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-sm font-medium text-muted">
          Nutrition per 100 {unit}
        </legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {MACRO_KEYS.map((key) => (
            <Field
              key={key}
              label={`${MACROS[key].label} (${MACROS[key].unit})`}
              hint={
                draft?.missing.includes(key)
                  ? "Missing: not guessed"
                  : undefined
              }
            >
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                max={MACROS[key].max}
                step="any"
                value={per100[key]}
                aria-invalid={outOfRange[key]}
                onChange={(e) =>
                  setPer100((p) => ({ ...p, [key]: e.target.value }))
                }
              />
            </Field>
          ))}
        </div>
        <p className="text-xs text-muted">
          Leave a blank for a macro the pack doesn&apos;t give: missing macros
          are flagged, not guessed.
        </p>
      </fieldset>

      {draft?.kcalFromKj && (
        <Notice>Energy converted from kJ: check it against the pack.</Notice>
      )}
      {draft?.inconsistent && (
        <Notice>
          These numbers don&apos;t add up: check them against the pack.
        </Notice>
      )}

      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <Field label="1 serving =">
          <Input
            type="number"
            inputMode="decimal"
            min="0.1"
            max="5000"
            step="any"
            value={serving}
            onChange={(e) => setServing(e.target.value)}
          />
        </Field>
        <select
          aria-label="Unit"
          className={cx(inputClass, "w-auto")}
          value={unit}
          onChange={(e) => setUnit(e.target.value as ServingUnit)}
        >
          <option value="g">g</option>
          <option value="ml">ml</option>
        </select>
      </div>
      <Field label={`Whole pack (${unit}, optional)`}>
        <Input
          type="number"
          inputMode="decimal"
          min="0.1"
          step="any"
          value={pack}
          onChange={(e) => setPack(e.target.value)}
        />
      </Field>

      <p className="text-sm text-muted tabular-nums" aria-live="polite">
        {servingValid
          ? nutritionLine(
              "Per serving",
              perServing(macrosValid ? values : {}, servingGrams)
            )
          : "Say how big one serving is to see its nutrition."}
      </p>

      <PortionPicker
        info={info}
        unit={unit}
        kind={kind}
        onKind={setKind}
        grams={grams}
        onGrams={setGrams}
      />
      {info && baseServings !== null && (
        <p className="text-sm text-muted tabular-nums" aria-live="polite">
          {nutritionLine(
            "This portion",
            perServing(
              macrosValid ? values : {},
              info.servingGrams * baseServings
            )
          )}
        </p>
      )}
      <AlreadyHad
        checked={alreadyHad}
        future={future}
        onChange={setAlreadyHad}
      />

      {draft && (
        <p className="text-xs text-muted">
          Data from{" "}
          <a
            href={draft.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            Open Food Facts
          </a>{" "}
          (ODbL).
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button block disabled={pending || !ready} onClick={save}>
          {pending ? "Saving…" : "Save and add"}
        </Button>
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
  );
};
