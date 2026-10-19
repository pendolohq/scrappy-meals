"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

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

const inputClass =
  "mt-1 w-full rounded-lg border border-border bg-card px-3 py-2";

/** Empty is "not set" (null); anything unreadable becomes NaN and is refused. */
const toNumber = (text: string): number | null =>
  text.trim() === "" ? null : Number(text.trim().replace(",", "."));

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
          MACROS.map((m) => [m.key, toNumber(nutrition[m.key])])
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
    <form onSubmit={submit} noValidate className="space-y-6">
      <label className="block">
        <span className="text-sm text-muted">Servings</span>
        <input
          type="text"
          inputMode="decimal"
          value={servings}
          onChange={(e) => setServings(e.target.value)}
          className={inputClass}
        />
      </label>

      <fieldset>
        <legend className="mb-2 font-medium">Nutrition per serving</legend>
        <p className="mb-3 text-sm text-muted">{nutritionLabel}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {MACROS.map((m) => (
            <label key={m.key} className="block">
              <span className="text-sm text-muted">{m.label}</span>
              <input
                type="text"
                inputMode="decimal"
                value={nutrition[m.key]}
                onChange={(e) =>
                  setNutrition((n) => ({ ...n, [m.key]: e.target.value }))
                }
                className={inputClass}
              />
              {draft.unreadableNutrition[m.key] && (
                <span className="text-xs text-muted">
                  Mealie has: {draft.unreadableNutrition[m.key]}
                </span>
              )}
            </label>
          ))}
        </div>
      </fieldset>

      <section className="space-y-3">
        <h2 className="font-medium">Ingredients</h2>
        {draft.lines.map((line, i) => {
          const state = lines[i];
          const low =
            line.confidence !== null && line.confidence < LOW_CONFIDENCE;
          const hint = low ? `check-${i}` : undefined;
          return (
            <div key={line.key}>
              {line.title && (
                <p className="mb-1 text-sm font-medium">{line.title}</p>
              )}
              <fieldset
                className={`rounded-lg border bg-card p-3 ${
                  low ? "border-danger" : "border-border"
                }`}
              >
                <legend className="px-1 text-sm">{line.original}</legend>
                {low && (
                  <p id={hint} className="mb-2 text-sm text-danger">
                    Check this line
                  </p>
                )}
                {!state.asText && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <label className="block">
                      <span className="text-sm text-muted">Amount</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-describedby={hint}
                        value={state.quantity}
                        onChange={(e) =>
                          setLine(i, { quantity: e.target.value })
                        }
                        className={inputClass}
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm text-muted">Unit</span>
                      <input
                        aria-describedby={hint}
                        value={state.unit}
                        onChange={(e) => setLine(i, { unit: e.target.value })}
                        className={inputClass}
                      />
                    </label>
                    <label className="col-span-2 block sm:col-span-1">
                      <span className="text-sm text-muted">Food</span>
                      <input
                        aria-describedby={hint}
                        value={state.food}
                        onChange={(e) => setLine(i, { food: e.target.value })}
                        className={inputClass}
                      />
                    </label>
                  </div>
                )}
                <label className="mt-2 block">
                  <span className="text-sm text-muted">Note</span>
                  <input
                    aria-describedby={hint}
                    value={state.note}
                    onChange={(e) =>
                      setLine(i, { note: e.target.value, noteEdited: true })
                    }
                    className={inputClass}
                  />
                </label>
                <label className="mt-2 flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={state.asText}
                    onChange={(e) => toggleText(i, e.target.checked)}
                  />
                  <span className="text-sm">Keep as text</span>
                </label>
              </fieldset>
            </div>
          );
        })}
      </section>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {/* Always in the page so screen readers announce "Saved" when it appears. */}
      <output className="block text-sm">{saved ? "Saved" : ""}</output>
      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-accent px-4 py-2 font-medium text-white disabled:opacity-60 dark:text-stone-900"
        >
          {pending ? "Saving…" : "Save recipe"}
        </button>
        {saved && (
          <Link href="/week" className="text-sm underline">
            Back to the plan
          </Link>
        )}
      </div>
    </form>
  );
};
