"use client";

import { useState, useTransition } from "react";
import { ArrowLeft, Check, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { Button, buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { inputClass } from "@/components/ui/input";
import { Pill, pillClass, type PillTone } from "@/components/ui/pill";
import { cx } from "@/lib/cx";
import {
  parseDecimal,
  THREE_DIGIT_GROUP,
  type ThreeDigitGroup,
} from "@/server/domain/decimal";
import {
  isQuick,
  QUICK_MAX_MINUTES,
  RECIPE_CATEGORIES,
  RECIPE_TAGS,
} from "@/server/domain/taxonomy";
import type { ReviewDraft } from "@/server/recipe-review";

import { estimateNutritionAction, saveReviewAction } from "./actions";

const MACROS = [
  { key: "kcal", label: "Calories (kcal)" },
  { key: "protein", label: "Protein (g)" },
  { key: "carbs", label: "Carbs (g)" },
  { key: "fat", label: "Fat (g)" },
  { key: "fibre", label: "Fibre (g)" },
] as const;

const SOURCE_LABELS = {
  source: "From the page",
  estimated: "Estimated",
  reviewed: "Reviewed",
} as const;

const LOW_CONFIDENCE = 0.8;

const field = cx(inputClass, "mt-1.5");
const fieldLabel = "text-sm font-medium text-muted";

const NUTRITION_TONE: Record<string, PillTone> = {
  Missing: "danger",
  Edited: "accent",
  Estimated: "neutral",
  Reviewed: "highlight",
  "From the page": "neutral",
};

/**
 * Empty is "not set" (null); anything unreadable becomes NaN and is refused.
 * "1,200" and "1.200" read the way the server reads Mealie's own values.
 */
const toNumber = (
  text: string,
  threeDigitGroup: ThreeDigitGroup = "thousands"
): number | null =>
  text.trim() === ""
    ? null
    : (parseDecimal(text, threeDigitGroup) ?? Number.NaN);

const macroTexts = (draft: ReviewDraft) =>
  Object.fromEntries(
    MACROS.map((m) => [m.key, String(draft.nutrition[m.key] ?? "")])
  );

/**
 * The agreed tags or categories as toggles. Ones added in Mealie outside the
 * list are shown, and kept on save, but not edited here.
 */
const ToggleGroup = <T extends string>({
  label,
  hint,
  options,
  selected,
  onChange,
  others,
}: {
  label: string;
  hint: string;
  options: readonly { name: string; slug: T }[];
  selected: T[];
  onChange: (next: T[]) => void;
  others: { name: string }[];
}) => (
  <fieldset className="min-w-0">
    <legend className={fieldLabel}>{label}</legend>
    <p className="text-xs text-muted">{hint}</p>
    <div className="mt-2 flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.includes(o.slug);
        return (
          <button
            key={o.slug}
            type="button"
            aria-pressed={on}
            onClick={() =>
              onChange(
                on
                  ? selected.filter((s) => s !== o.slug)
                  : options
                      .map((x) => x.slug)
                      .filter((s) => s === o.slug || selected.includes(s))
              )
            }
            className={cx(
              pillClass(on ? "solid" : "neutral", true),
              "min-h-tap px-3 text-sm",
              !on && "hover:text-foreground"
            )}
          >
            {on && <Check className="size-3.5" aria-hidden />}
            {o.name}
          </button>
        );
      })}
    </div>
    {others.length > 0 && (
      <p className="mt-2 text-xs text-muted">
        Also in Mealie: {others.map((o) => o.name).join(", ")}
      </p>
    )}
  </fieldset>
);

/** One line as the estimate should read it, with the form's edits. */
const lineText = (line: {
  asText: boolean;
  quantity: string;
  unit: string;
  food: string;
  note: string;
}) =>
  line.asText || line.food.trim() === ""
    ? line.note.trim()
    : [line.quantity, line.unit, line.food, line.note]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(" ");

export const ReviewForm = ({
  draft,
  canEstimate,
}: {
  draft: ReviewDraft;
  /** False when the server has no API key for estimating. */
  canEstimate: boolean;
}) => {
  const [servings, setServings] = useState(String(draft.servings ?? ""));
  const [totalMinutes, setTotalMinutes] = useState(
    String(draft.totalMinutes ?? "")
  );
  const [tags, setTags] = useState(draft.tags);
  const [categories, setCategories] = useState(draft.categories);
  const [nutrition, setNutrition] = useState(macroTexts(draft));
  // What the fields held when loaded or last saved, to tell edits apart.
  const [baseline, setBaseline] = useState(macroTexts(draft));
  const [nutritionSource, setNutritionSource] = useState(
    draft.importState.nutrition
  );
  const [lines, setLines] = useState(
    draft.lines.map((l) => ({
      asText: l.asText,
      quantity: String(l.quantity ?? ""),
      unit: l.unit ?? "",
      food: l.food ?? "",
      // The parser's leftover words ("pinches") would lose the rest of a
      // plain-text line, so those start from the whole line.
      note: l.asText ? l.original : l.note,
      noteEdited: false,
    }))
  );
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const [estimateError, setEstimateError] = useState<string>();
  const [estimating, startEstimate] = useTransition();

  const setLine = (i: number, patch: Partial<(typeof lines)[number]>) => {
    setLines((all) => all.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  };

  const toggleText = (i: number, asText: boolean) => {
    const line = draft.lines[i];
    setLine(i, {
      asText,
      ...(lines[i].noteEdited
        ? {}
        : { note: asText ? line.original : line.note }),
    });
  };

  const minutes = toNumber(totalMinutes);

  const anyMacro = Object.values(nutrition).some((v) => v.trim() !== "");
  const edited = MACROS.some((m) => nutrition[m.key] !== baseline[m.key]);
  const nutritionLabel = !anyMacro
    ? "Missing"
    : edited
      ? "Edited"
      : SOURCE_LABELS[nutritionSource ?? "source"];

  const estimate = () => {
    setEstimateError(undefined);
    setSaved(false);
    startEstimate(async () => {
      const result = await estimateNutritionAction({
        name: draft.name,
        // Unreadable servings count as unknown: the estimate picks a number.
        servings: toNumber(servings) || null,
        ingredients: lines.map(lineText).filter(Boolean),
      });
      if (result.error !== undefined) {
        setEstimateError(result.error);
        return;
      }
      const values = Object.fromEntries(
        MACROS.map((m) => [m.key, String(result.estimate.perServing[m.key])])
      );
      setNutrition(values);
      // Shown as "Estimated" until edited; saving the review confirms it.
      setBaseline(values);
      setNutritionSource("estimated");
      if (!(toNumber(servings) ?? 0)) {
        setServings(String(result.estimate.servings));
      }
    });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setSaved(false);
    startTransition(async () => {
      const result = await saveReviewAction({
        slug: draft.slug,
        // NaN is refused by the server with a message about servings.
        servings: toNumber(servings) ?? Number.NaN,
        totalMinutes: toNumber(totalMinutes),
        tags,
        categories,
        nutrition: Object.fromEntries(
          MACROS.map((m) => [
            m.key,
            toNumber(nutrition[m.key], THREE_DIGIT_GROUP[m.key]),
          ])
        ) as Record<(typeof MACROS)[number]["key"], number | null>,
        lines: lines.map((l, i) => {
          const asText = l.asText || l.food.trim() === "";
          return {
            referenceId: draft.lines[i].key,
            title: draft.lines[i].title,
            asText,
            quantity: toNumber(l.quantity),
            unit: l.unit.trim() || null,
            food: l.food.trim() || null,
            // A plain-text line keeps its words even if the note is empty.
            note: asText
              ? l.note.trim() || draft.lines[i].original
              : l.note.trim(),
          };
        }),
      });
      if (result.error !== undefined) {
        setError(result.error);
        return;
      }
      setNutritionSource(anyMacro ? "reviewed" : null);
      setBaseline(nutrition);
      setSaved(true);
    });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap gap-3">
          <label className="block w-36">
            <span className={fieldLabel}>Servings</span>
            <input
              type="text"
              inputMode="decimal"
              value={servings}
              onChange={(e) => setServings(e.target.value)}
              className={field}
            />
          </label>
          <label className="block w-36">
            <span className={fieldLabel}>Total time (min)</span>
            <input
              type="text"
              inputMode="numeric"
              value={totalMinutes}
              onChange={(e) => setTotalMinutes(e.target.value)}
              aria-describedby="total-time-hint"
              className={field}
            />
          </label>
        </div>
        <p id="total-time-hint" className="text-sm text-muted">
          {minutes === null ? (
            <>
              No total time yet. Add one so the <q>Quick</q> filter can find
              this recipe.
            </>
          ) : isQuick(minutes) ? (
            <>Counts as quick ({QUICK_MAX_MINUTES} minutes or less).</>
          ) : (
            <>Prep and cooking together, start to finish.</>
          )}
        </p>
      </Card>

      <Card as="section" className="space-y-4" aria-labelledby="organizers">
        <h2 id="organizers" className="font-serif text-heading font-semibold">
          Tags and categories
        </h2>
        <ToggleGroup
          label="Tags"
          hint="When or how you'd eat it."
          options={RECIPE_TAGS}
          selected={tags}
          onChange={setTags}
          others={draft.otherTags}
        />
        <ToggleGroup
          label="Categories"
          hint="What's in it. Usually one."
          options={RECIPE_CATEGORIES}
          selected={categories}
          onChange={setCategories}
          others={draft.otherCategories}
        />
      </Card>

      <Card as="fieldset" className="min-w-0">
        <legend className="sr-only">Nutrition per serving</legend>
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 aria-hidden className="font-serif text-heading font-semibold">
            Nutrition per serving
          </h2>
          <Pill tone={NUTRITION_TONE[nutritionLabel] ?? "neutral"}>
            {nutritionLabel}
          </Pill>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {MACROS.map((m) => (
            <label key={m.key} className="block">
              <span className={fieldLabel}>{m.label}</span>
              <input
                type="text"
                inputMode="decimal"
                value={nutrition[m.key]}
                onChange={(e) =>
                  setNutrition((n) => ({ ...n, [m.key]: e.target.value }))
                }
                className={field}
              />
              {draft.unreadableNutrition[m.key] && (
                <span className="mt-1 block text-xs text-muted">
                  Mealie has: {draft.unreadableNutrition[m.key]}
                </span>
              )}
            </label>
          ))}
        </div>
        {canEstimate && (
          <div className="mt-4 space-y-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={estimate}
              disabled={estimating || pending}
            >
              <Sparkles className="size-3.5" aria-hidden />
              {estimating ? "Estimating…" : "Estimate from ingredients"}
            </Button>
            {estimateError ? (
              <p role="alert" className="text-sm text-danger">
                {estimateError}
              </p>
            ) : (
              <p className="text-xs text-muted">
                Claude works it out from the servings and ingredients on this
                page. Check the numbers before saving.
              </p>
            )}
          </div>
        )}
      </Card>

      <Card as="section" className="space-y-4">
        <h2 className="font-serif text-heading font-semibold">Ingredients</h2>
        {draft.lines.map((line, i) => {
          const state = lines[i];
          const low =
            line.confidence !== null && line.confidence < LOW_CONFIDENCE;
          const hint = low ? `check-${i}` : undefined;
          return (
            <div key={line.key}>
              {line.title && (
                <p className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">
                  {line.title}
                </p>
              )}
              <fieldset
                className={cx(
                  "min-w-0 rounded-control border p-3 sm:p-4",
                  // A floated legend is laid out inside the box like any
                  // block; left in place, browsers draw it across the border.
                  "[&>legend+*]:clear-left",
                  low
                    ? "border-danger/60 bg-danger-soft/40"
                    : "border-border bg-sunken/40"
                )}
              >
                <legend className="float-left mb-2 w-full font-medium break-words">
                  {line.original}
                </legend>
                {line.linked && (
                  <p className="text-sm text-muted">
                    Linked recipe: edit it in Mealie
                  </p>
                )}
                {low && (
                  <p
                    id={hint}
                    className="mb-2 flex items-center gap-1.5 text-sm font-medium text-danger"
                  >
                    <TriangleAlert className="size-4" aria-hidden />
                    Check this line
                  </p>
                )}
                {!line.linked && !state.asText && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_2fr]">
                    <label className="block">
                      <span className={fieldLabel}>Amount</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-describedby={hint}
                        value={state.quantity}
                        onChange={(e) =>
                          setLine(i, { quantity: e.target.value })
                        }
                        className={field}
                      />
                    </label>
                    <label className="block">
                      <span className={fieldLabel}>Unit</span>
                      <input
                        aria-describedby={hint}
                        value={state.unit}
                        onChange={(e) => setLine(i, { unit: e.target.value })}
                        className={field}
                      />
                    </label>
                    <label className="col-span-2 block sm:col-span-1">
                      <span className={fieldLabel}>Food</span>
                      <input
                        aria-describedby={hint}
                        value={state.food}
                        onChange={(e) => setLine(i, { food: e.target.value })}
                        className={field}
                      />
                    </label>
                  </div>
                )}
                {!line.linked && (
                  <>
                    <label className="mt-2 block">
                      <span className={fieldLabel}>Note</span>
                      <input
                        aria-describedby={hint}
                        value={state.note}
                        onChange={(e) =>
                          setLine(i, { note: e.target.value, noteEdited: true })
                        }
                        className={field}
                      />
                    </label>
                    <label className="mt-1 flex min-h-tap w-fit cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        className="size-4 accent-accent"
                        checked={state.asText}
                        onChange={(e) => toggleText(i, e.target.checked)}
                      />
                      <span className="text-sm">Keep as text</span>
                    </label>
                  </>
                )}
              </fieldset>
            </div>
          );
        })}
      </Card>

      {error && (
        <p
          role="alert"
          className="rounded-control bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          {error}
        </p>
      )}
      {/* Always in the page so screen readers announce "Saved" when it appears. */}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : "Save recipe"}
        </Button>
        <output className="flex items-center gap-1.5 text-sm font-medium text-accent-ink">
          {saved ? (
            <>
              <Check className="size-4" aria-hidden />
              Saved
            </>
          ) : (
            ""
          )}
        </output>
        {saved && (
          <Link
            href="/week"
            className={cx(buttonClass({ variant: "ghost" }), "ml-auto")}
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back to the plan
          </Link>
        )}
      </div>
    </form>
  );
};
