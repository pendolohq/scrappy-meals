"use client";

import { useState, useTransition } from "react";

import { addMealAction, saveProductAction } from "@/app/(app)/week/actions";
import { Button } from "@/components/ui/button";
import { Field, Input, inputClass } from "@/components/ui/input";
import { cx } from "@/lib/cx";
import { formatAmount } from "@/lib/format";
import {
  type PortionChoice,
  perServing,
  type ProductDraft,
  type ProductInfo,
  type ServingUnit,
  servingsFor,
} from "@/server/domain/product";
import type { SlotType } from "@/server/domain/slots";
import {
  MACRO_KEYS,
  type MacroKey,
  type Macros,
} from "@/server/mealie/nutrition";
import type { ProductLookup } from "@/server/products";

import { attempt, failureText } from "./attempt";

export type Slot = { date: string; slot: SlotType; snackIndex: number };

const MACROS: Record<MacroKey, { label: string; unit: string; max: number }> = {
  kcal: { label: "Energy", unit: "kcal", max: 1000 },
  protein: { label: "Protein", unit: "g", max: 100 },
  carbs: { label: "Carbs", unit: "g", max: 100 },
  fat: { label: "Fat", unit: "g", max: 100 },
  fibre: { label: "Fibre", unit: "g", max: 100 },
};

/** "Per serving: 240 kcal · 4.3 g protein"; only what is known. */
const nutritionLine = (prefix: string, values: Partial<Macros>) => {
  const parts = MACRO_KEYS.flatMap((key) => {
    const v = values[key];
    if (v === undefined) {
      return [];
    }
    return key === "kcal"
      ? [`${formatAmount(v)} kcal`]
      : [`${v} g ${MACROS[key].label.toLowerCase()}`];
  });
  return parts.length > 0
    ? `${prefix}: ${parts.join(" · ")}`
    : "No nutrition values yet";
};

/** The nutrition of `servings` servings, to one decimal. */
const scaled = (values: Partial<Macros>, servings: number): Partial<Macros> =>
  Object.fromEntries(
    MACRO_KEYS.flatMap((k) =>
      values[k] === undefined
        ? []
        : [[k, Math.round(values[k] * servings * 10) / 10]]
    )
  );

const number = (text: string): number | undefined =>
  text.trim() === "" ? undefined : Number(text);

type PortionKind = "one" | "half" | "pack" | "grams";

/** A pack the same size as a serving is just "1 serving". */
const hasPack = (info: ProductInfo | null) =>
  info?.packGrams != null && info.packGrams !== info.servingGrams;

/** The picked portion, or a serving when "whole pack" stopped being possible. */
const usable = (kind: PortionKind, info: ProductInfo | null): PortionKind =>
  kind === "pack" && !hasPack(info) ? "one" : kind;

const choiceOf = (kind: PortionKind, grams: string): PortionChoice => {
  switch (kind) {
    case "one":
      return { kind: "servings", count: 1 };
    case "half":
      return { kind: "servings", count: 0.5 };
    case "pack":
      return { kind: "pack" };
    case "grams":
      return { kind: "grams", grams: Number(grams) };
  }
};

/** How much was eaten: a serving, half, the whole pack, or an amount in g or ml. */
const PortionPicker = ({
  info,
  unit,
  kind,
  onKind,
  grams,
  onGrams,
}: {
  info: ProductInfo | null;
  unit: ServingUnit;
  kind: PortionKind;
  onKind: (kind: PortionKind) => void;
  grams: string;
  onGrams: (grams: string) => void;
}) => {
  const options: { kind: PortionKind; label: string }[] = [
    {
      kind: "one",
      label: info ? `1 serving (${info.servingGrams} ${unit})` : "1 serving",
    },
    { kind: "half", label: "½" },
    ...(info && hasPack(info)
      ? [
          {
            kind: "pack" as const,
            label: `Whole pack (${info.packGrams} ${unit})`,
          },
        ]
      : []),
    { kind: "grams", label: unit === "ml" ? "Millilitres…" : "Grams…" },
  ];
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1.5 text-sm font-medium text-muted">
        How much
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.kind}
            type="button"
            aria-pressed={kind === o.kind}
            onClick={() => onKind(o.kind)}
            className={cx(
              "min-h-tap rounded-button border px-3.5 text-sm font-medium transition",
              kind === o.kind
                ? "border-accent bg-accent text-accent-foreground"
                : "border-border-strong bg-card hover:bg-sunken"
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {kind === "grams" && (
        <Field label={`Amount (${unit})`}>
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={grams}
            onChange={(e) => onGrams(e.target.value)}
          />
        </Field>
      )}
    </fieldset>
  );
};

const AlreadyHad = ({
  checked,
  future,
  onChange,
}: {
  checked: boolean;
  /** A day still to come can't be "already had". */
  future: boolean;
  onChange: (checked: boolean) => void;
}) => (
  <label className="flex min-h-tap items-center gap-3 text-sm">
    <input
      type="checkbox"
      className="size-5 accent-accent"
      checked={checked && !future}
      disabled={future}
      onChange={(e) => onChange(e.target.checked)}
    />
    <span>
      <span className="font-medium">Already had it?</span>{" "}
      <span className="text-muted">
        {future
          ? "That day is still to come."
          : "Logged as eaten, outside the plan."}
      </span>
    </span>
  </label>
);

const Notice = ({ children }: { children: string }) => (
  <p className="rounded-control bg-highlight-soft px-3 py-2 text-sm text-highlight">
    {children}
  </p>
);

/** A product Mealie already has: its nutrition as saved, and how much to add. */
const KnownSheet = ({
  lookup,
  at,
  future,
  onAdded,
  onBack,
}: {
  lookup: Extract<ProductLookup, { status: "known" }>;
  at: Slot;
  future: boolean;
  onAdded: () => void;
  onBack: () => void;
}) => {
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

/**
 * A product to check before it is saved: from Open Food Facts (`draft`), or
 * empty to type in from the pack. Macros are per 100 g (or ml), as printed.
 */
const DraftSheet = ({
  barcode,
  draft,
  at,
  future,
  onAdded,
  onBack,
}: {
  barcode: string;
  draft: ProductDraft | null;
  at: Slot;
  future: boolean;
  onAdded: () => void;
  onBack: () => void;
}) => {
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
      <Field label="Name">
        <Input
          value={name}
          maxLength={120}
          required
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

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

/** What to do with a barcode lookup: add a known product, or check a new one. */
export const ProductSheet = ({
  lookup,
  ...rest
}: {
  lookup: ProductLookup;
  at: Slot;
  future: boolean;
  onAdded: () => void;
  onBack: () => void;
}) => {
  switch (lookup.status) {
    case "known":
      return <KnownSheet lookup={lookup} {...rest} />;
    case "draft":
      return (
        <DraftSheet
          barcode={lookup.draft.barcode}
          draft={lookup.draft}
          {...rest}
        />
      );
    case "not-found":
      return <DraftSheet barcode={lookup.barcode} draft={null} {...rest} />;
  }
};
