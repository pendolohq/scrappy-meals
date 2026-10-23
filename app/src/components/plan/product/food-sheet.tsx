"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { estimateNutritionAction } from "@/app/(app)/recipes/[slug]/review/actions";
import { searchUsdaAction } from "@/app/(app)/recipes/nutrition-check/actions";
import {
  findFoodsAction,
  loadFoodAction,
  saveFoodAction,
  usdaFoodAction,
} from "@/app/(app)/week/actions";
import { Button } from "@/components/ui/button";
import { Field, Input, inputClass } from "@/components/ui/input";
import { cx } from "@/lib/cx";
import { parseDecimal } from "@/server/domain/decimal";
import {
  defaultPiece,
  type FoodUnit,
  type LineFood,
  piecePortions,
  servingLabel,
  servingNutrition,
} from "@/server/domain/food";
import { OWN_VALUES, type UsdaFood, type UsdaHit } from "@/server/domain/usda";
import { roundMacro } from "@/server/domain/usda-check";
import type { FoodCandidate, FoodSearch, KnownFood } from "@/server/foods";
import {
  MACRO_KEYS,
  type MacroKey,
  type Macros,
} from "@/server/mealie/nutrition";

import { attempt, failureText } from "../attempt";

import { AlreadyHad } from "./already-had";
import { Notice } from "./notice";
import { MACROS, nutritionLine } from "./nutrition";
import type { SheetProps } from "./sheet-props";

/** The Mealie food picked, or a new one named like the food. */
type Picked = { food: FoodCandidate } | { create: string };

/** Where the serving's nutrition comes from. */
type Source = { kind: "usda"; food: UsdaFood } | { kind: "own" };

const UNIT_LABELS: Record<FoodUnit, string> = {
  piece: "pieces",
  g: "g",
  ml: "ml",
};

// A sensible first amount when the unit changes.
const STARTING_AMOUNT: Record<FoodUnit, string> = {
  piece: "1",
  g: "100",
  ml: "200",
};

const grams = (n: number) => String(Math.round(n * 100) / 100);

const decimal = (text: string) =>
  text.trim() === "" ? null : parseDecimal(text, "refuse");

const emptyValues = () =>
  Object.fromEntries(MACRO_KEYS.map((k) => [k, ""])) as Record<
    MacroKey,
    string
  >;

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
  const [name, setName] = useState("");
  const [found, setFound] = useState<FoodSearch & { name: string }>();
  const [picked, setPicked] = useState<Picked>();
  const [source, setSource] = useState<Source>();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<UsdaHit[]>();
  const [amount, setAmount] = useState(STARTING_AMOUNT.piece);
  const [unit, setUnit] = useState<FoodUnit>("piece");
  const [pieceText, setPieceText] = useState("");
  // The USDA portion the piece weight came from; typing one drops it.
  const [pieceLabel, setPieceLabel] = useState<string | null>(null);
  const [values, setValues] = useState(emptyValues);
  const [estimated, setEstimated] = useState(false);
  const [alreadyHad, setAlreadyHad] = useState(!future);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const field = useRef<HTMLInputElement>(null);

  // Opened from "Add it by name": the name is what comes next.
  useEffect(() => {
    field.current?.focus();
  }, []);

  const run = (work: () => Promise<void>) =>
    startTransition(async () => {
      setError(undefined);
      await work();
    });

  const find = () =>
    run(async () => {
      const typed = name.trim();
      const res = await attempt(() => findFoodsAction({ name: typed }));
      if (res.error !== undefined) {
        setError(failureText(res));
        return;
      }
      setFound({ ...res, name: typed });
      setPicked(undefined);
      setSource(undefined);
      setHits(undefined);
      setQuery(typed);
    });

  const openKnown = (slug: string) =>
    run(async () => {
      const res = await attempt(() => loadFoodAction({ slug }));
      if (res.error !== undefined) {
        setError(failureText(res));
      } else {
        onKnown(res);
      }
    });

  const takeUsda = (
    food: UsdaFood,
    weight: number | null,
    label: string | null
  ) => {
    setSource({ kind: "usda", food });
    const portion = defaultPiece(food.portions);
    const piece = weight ?? portion?.grams ?? null;
    setPieceText(piece === null ? "" : grams(piece));
    setPieceLabel(weight === null ? (portion?.label ?? null) : label);
  };

  const pick = (next: Picked, usdaOn: boolean) => {
    setPicked(next);
    setHits(undefined);
    const match = "food" in next ? next.food.match : null;
    if (match?.status === "confirmed") {
      takeUsda(match.food, match.pieceGrams, match.pieceLabel);
    } else {
      setSource(usdaOn ? undefined : { kind: "own" });
    }
  };

  const searchUsda = () =>
    run(async () => {
      const res = await attempt(() => searchUsdaAction({ query }));
      if (res.error !== undefined) {
        setError(failureText(res));
      } else {
        setHits(res.hits);
      }
    });

  const chooseHit = (fdcId: number) =>
    run(async () => {
      const res = await attempt(() => usdaFoodAction({ fdcId }));
      if (res.error !== undefined) {
        setError(failureText(res));
        return;
      }
      // The food's own weight of one holds for the USDA food it was set with.
      const match = picked && "food" in picked ? picked.food.match : null;
      const keep = match?.fdcId === fdcId ? match : null;
      takeUsda(res.food, keep?.pieceGrams ?? null, keep?.pieceLabel ?? null);
    });

  const lineFood: LineFood | null = picked
    ? "food" in picked
      ? picked.food
      : { id: "new", name: picked.create, gramsPerMl: null }
    : null;
  const amountValue = decimal(amount);
  const piece = decimal(pieceText);
  const amountOk = amountValue !== null && amountValue > 0;
  const pieceOk = unit !== "piece" || (piece !== null && piece > 0);
  const serving = amountOk ? { amount: amountValue, unit } : null;

  const counted =
    source?.kind === "usda" && serving && lineFood
      ? servingNutrition(serving, lineFood, {
          fdcId: source.food.fdcId,
          status: "confirmed",
          pieceGrams: pieceOk && unit === "piece" ? piece : null,
          unitGrams: {},
          defaultGrams: null,
          food: source.food,
        })
      : null;

  const ownValues: Partial<Macros> = {};
  let ownInvalid = false;
  for (const key of MACRO_KEYS) {
    const v = decimal(values[key]);
    if (values[key].trim() !== "" && (v === null || v < 0)) {
      ownInvalid = true;
    } else if (v !== null) {
      ownValues[key] = v;
    }
  }

  const estimate = () =>
    run(async () => {
      if (!serving || !lineFood) {
        return;
      }
      const label = servingLabel({
        ...serving,
        grams: unit === "piece" && piece ? piece * serving.amount : null,
      });
      const res = await attempt(() =>
        estimateNutritionAction({
          name: name.trim() || lineFood.name,
          servings: 1,
          ingredients: [`${label} ${lineFood.name}`],
        })
      );
      if (res.error !== undefined) {
        setError(failureText(res));
        return;
      }
      setValues(
        Object.fromEntries(
          MACRO_KEYS.map((k) => [
            k,
            String(roundMacro(k, res.estimate.perServing[k])),
          ])
        ) as Record<MacroKey, string>
      );
      setEstimated(true);
    });

  const ready =
    picked !== undefined &&
    serving !== null &&
    pieceOk &&
    (source?.kind === "usda"
      ? counted !== null && !("problem" in counted)
      : source?.kind === "own" && !ownInvalid && ownValues.kcal !== undefined);

  const save = () =>
    run(async () => {
      if (!ready || !picked || !serving || !source) {
        return;
      }
      const { kcal } = ownValues;
      const values =
        source.kind === "usda"
          ? ({ from: "usda", fdcId: source.food.fdcId } as const)
          : kcal === undefined
            ? null
            : ({
                from: "own",
                perServing: { ...ownValues, kcal },
                estimated,
              } as const);
      if (!values) {
        return;
      }
      // A food counted by the piece is saved as one piece and planned as
      // that many servings, so adding it again starts from one.
      const pieces = serving.unit === "piece";
      const res = await attempt(() =>
        saveFoodAction({
          ...at,
          name: name.trim() || (found?.name ?? ""),
          food:
            "food" in picked
              ? { id: picked.food.id }
              : { create: picked.create },
          serving: pieces ? { amount: 1, unit: "piece" } : serving,
          pieceGrams: unit === "piece" ? piece : null,
          pieceLabel: unit === "piece" ? pieceLabel : null,
          nutrition: values,
          baseServings: pieces ? serving.amount : 1,
          alreadyHad: alreadyHad && !future,
        })
      );
      if (res.error !== undefined) {
        setError(failureText(res));
      } else {
        onAdded();
      }
    });

  // Another USDA food than the one this Mealie food is matched to.
  const confirmed =
    picked && "food" in picked && picked.food.match?.status === "confirmed"
      ? picked.food
      : null;
  const replacing =
    confirmed &&
    source?.kind === "usda" &&
    source.food.fdcId !== confirmed.match!.fdcId
      ? confirmed.name
      : null;
  // The same USDA food with another piece weight than the one it has.
  const repiecing =
    confirmed &&
    !replacing &&
    source?.kind === "usda" &&
    unit === "piece" &&
    confirmed.match!.pieceGrams !== null &&
    piece !== null &&
    piece !== confirmed.match!.pieceGrams
      ? confirmed.name
      : null;

  const exact = found?.foods.some(
    (f) => f.name.trim().toLowerCase() === found.name.toLowerCase()
  );
  const isPicked = (next: Picked) =>
    picked !== undefined &&
    ("food" in next
      ? "food" in picked && picked.food.id === next.food.id
      : "create" in picked);

  return (
    <div className="space-y-5">
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          find();
        }}
      >
        <Field label="Name" hint="A kiwi, a glass of milk, a cappuccino.">
          <Input
            ref={field}
            autoComplete="off"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            placeholder="Kiwi"
          />
        </Field>
        <Button
          type="submit"
          block
          variant={found ? "secondary" : "primary"}
          disabled={pending || name.trim() === ""}
        >
          {pending && !found ? "Looking…" : "Find"}
        </Button>
      </form>

      {found && found.recipes.length > 0 && (
        <section className="space-y-1" aria-label="Added before">
          <h3 className="text-sm font-medium text-muted">Added before</h3>
          <ul>
            {found.recipes.map((r) => (
              <li key={r.slug}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => openKnown(r.slug)}
                  className="flex min-h-tap w-full items-center rounded-button px-2 text-left font-serif font-semibold transition hover:bg-sunken disabled:opacity-60"
                >
                  {r.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {found && (
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-sm font-medium text-muted">
            Which food is it in Mealie?
          </legend>
          <div className="flex flex-col gap-1.5">
            {[
              ...found.foods.map((food) => ({ food }) as Picked),
              ...(exact ? [] : [{ create: found.name } as Picked]),
            ].map((option) => {
              const key = "food" in option ? option.food.id : "new";
              const match = "food" in option ? option.food.match : null;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={isPicked(option)}
                  onClick={() => pick(option, found.usda)}
                  className={cx(
                    "min-h-tap rounded-button border px-3.5 py-2 text-left text-sm transition",
                    isPicked(option)
                      ? "border-accent bg-accent-soft"
                      : "border-border-strong bg-card hover:bg-sunken"
                  )}
                >
                  <span className="font-medium">
                    {"food" in option
                      ? option.food.name
                      : `New food: ${option.create}`}
                  </span>
                  <span className="block text-xs text-muted">
                    {match?.status === "confirmed"
                      ? match.food.dataType === OWN_VALUES
                        ? "Matched to values from its label"
                        : `USDA: ${match.food.description}`
                      : "food" in option
                        ? "Not matched to USDA yet"
                        : "Added to Mealie's foods"}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {found && picked && !source && (
        <div className="space-y-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              searchUsda();
            }}
          >
            <Input
              aria-label="Search USDA"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="In English, such as kiwifruit, raw"
            />
            <Button type="submit" variant="secondary" disabled={pending}>
              Search USDA
            </Button>
          </form>
          {hits && hits.length === 0 && (
            <p className="text-sm text-muted">
              Nothing found. Try other words.
            </p>
          )}
          {hits && hits.length > 0 && (
            <ul className="divide-y divide-border/70">
              {hits.map((hit) => (
                <li
                  key={hit.fdcId}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <div className="min-w-0 text-sm">
                    <p className="font-medium">{hit.description}</p>
                    <p className="text-muted">
                      {hit.dataType}
                      {hit.per100g.kcal !== undefined &&
                        ` · ${Math.round(hit.per100g.kcal)} kcal per 100 g`}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => chooseHit(hit.fdcId)}
                    disabled={pending}
                  >
                    Use
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSource({ kind: "own" })}
          >
            {found.estimating
              ? "Not in USDA? Estimate it"
              : "Not in USDA? Type its values"}
          </Button>
        </div>
      )}

      {picked && source && (
        <div className="space-y-4">
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="text-muted">
              {source.kind === "own"
                ? "Nutrition:"
                : source.food.dataType === OWN_VALUES
                  ? "Values from its label:"
                  : "USDA:"}
            </span>
            <span className="font-medium">
              {source.kind === "usda"
                ? source.food.description
                : found?.estimating
                  ? "estimated or typed in"
                  : "typed in"}
            </span>
            {(found?.usda || source.kind === "usda") && (
              <button
                type="button"
                className="text-accent-ink underline underline-offset-2"
                // Without USDA there is nothing to search: the other way is
                // an estimate or values typed in.
                onClick={() =>
                  setSource(found?.usda ? undefined : { kind: "own" })
                }
              >
                Change
              </button>
            )}
          </p>

          {replacing && (
            <Notice>{`Saving changes the USDA match of ${replacing} for every recipe that uses it.`}</Notice>
          )}
          {repiecing && (
            <Notice>{`Saving changes what one ${repiecing} weighs for every recipe that uses it.`}</Notice>
          )}

          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <Field label="How much">
              <Input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="any"
                value={amount}
                aria-invalid={!amountOk || undefined}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <select
              aria-label="Unit"
              className={cx(inputClass, "w-auto")}
              value={unit}
              onChange={(e) => {
                const next = e.target.value as FoodUnit;
                setUnit(next);
                setAmount(STARTING_AMOUNT[next]);
              }}
            >
              {(Object.keys(UNIT_LABELS) as FoodUnit[]).map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABELS[u]}
                </option>
              ))}
            </select>
          </div>

          {unit === "piece" && (
            <div className="grid gap-3 sm:grid-cols-2">
              {source.kind === "usda" &&
                piecePortions(source.food.portions).length > 0 && (
                  <Field label="One piece is">
                    <select
                      className={inputClass}
                      value={piecePortions(source.food.portions).findIndex(
                        (p) => p.label === pieceLabel
                      )}
                      onChange={(e) => {
                        const p = piecePortions(source.food.portions)[
                          Number(e.target.value)
                        ];
                        setPieceText(p ? grams(p.grams) : "");
                        setPieceLabel(p?.label ?? null);
                      }}
                    >
                      <option value={-1}>Typed in</option>
                      {piecePortions(source.food.portions).map((p, i) => (
                        <option key={`${p.label}-${i}`} value={i}>
                          {p.label} ({grams(p.grams)} g)
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              <Field
                label="Weight of one piece (g)"
                hint={
                  source.kind === "usda"
                    ? "Saved with the food, for every recipe that counts it by the piece."
                    : undefined
                }
              >
                <Input
                  inputMode="decimal"
                  value={pieceText}
                  aria-invalid={!pieceOk || undefined}
                  onChange={(e) => {
                    setPieceText(e.target.value);
                    setPieceLabel(null);
                  }}
                />
              </Field>
            </div>
          )}

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
            <fieldset className="space-y-2">
              <legend className="mb-1.5 text-sm font-medium text-muted">
                Nutrition for{" "}
                {serving
                  ? servingLabel({ ...serving, grams: null })
                  : "this serving"}
              </legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {MACRO_KEYS.map((key) => (
                  <Field
                    key={key}
                    label={`${MACROS[key].label} (${MACROS[key].unit})`}
                  >
                    <Input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      value={values[key]}
                      onChange={(e) => {
                        setValues((v) => ({ ...v, [key]: e.target.value }));
                        setEstimated(false);
                      }}
                    />
                  </Field>
                ))}
              </div>
              {found?.estimating && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending || !serving || !pieceOk}
                  onClick={estimate}
                >
                  {estimated ? "Estimate again" : "Estimate with Claude"}
                </Button>
              )}
              {estimated && (
                <p className="text-xs text-muted">
                  Claude&rsquo;s estimate: check it, and change anything that
                  looks off.
                </p>
              )}
            </fieldset>
          )}

          <AlreadyHad
            checked={alreadyHad}
            future={future}
            onChange={setAlreadyHad}
          />
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
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
