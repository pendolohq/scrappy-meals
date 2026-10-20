"use client";

import { useState, useTransition } from "react";
import { ArrowLeft, Check, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { Button, buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { inputClass } from "@/components/ui/input";
import { Pill, type PillTone } from "@/components/ui/pill";
import { cx } from "@/lib/cx";
import {
  parseDecimal,
  THREE_DIGIT_GROUP,
  type ThreeDigitGroup,
} from "@/server/domain/decimal";
import type { ReviewDraft } from "@/server/recipe-review";

import { saveReviewAction } from "./actions";

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
  Edited: "highlight",
  Estimated: "neutral",
  Reviewed: "accent",
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

export const ReviewForm = ({ draft }: { draft: ReviewDraft }) => {
  const [servings, setServings] = useState(String(draft.servings ?? ""));
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

  const anyMacro = Object.values(nutrition).some((v) => v.trim() !== "");
  const edited = MACROS.some((m) => nutrition[m.key] !== baseline[m.key]);
  const nutritionLabel = !anyMacro
    ? "Missing"
    : edited
      ? "Edited"
      : SOURCE_LABELS[nutritionSource ?? "source"];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setSaved(false);
    startTransition(async () => {
      const result = await saveReviewAction({
        slug: draft.slug,
        // NaN is refused by the server with a message about servings.
        servings: toNumber(servings) ?? Number.NaN,
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
      <Card>
        <label className="block max-w-40">
          <span className={fieldLabel}>Servings</span>
          <input
            type="text"
            inputMode="decimal"
            value={servings}
            onChange={(e) => setServings(e.target.value)}
            className={field}
          />
        </label>
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
                  "min-w-0 rounded-control border p-3 pt-1 sm:p-4 sm:pt-1.5",
                  low
                    ? "border-danger/60 bg-danger-soft/40"
                    : "border-border bg-sunken/40"
                )}
              >
                <legend className="px-1.5 font-medium">{line.original}</legend>
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
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
        <output className="flex items-center gap-1.5 text-sm font-medium text-accent">
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
