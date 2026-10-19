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

const input = "mt-1 w-full rounded-lg border border-border bg-card px-3 py-2";

/** Empty is "not set" (null); anything unreadable becomes NaN and is refused. */
const toNumber = (text: string): number | null =>
  text.trim() === "" ? null : Number(text.trim().replace(",", "."));

export const ReviewForm = ({ draft }: { draft: ReviewDraft }) => {
  const [servings, setServings] = useState(String(draft.servings ?? ""));
  const [nutrition, setNutrition] = useState(
    Object.fromEntries(
      MACROS.map((m) => [m.key, String(draft.nutrition[m.key] ?? "")])
    )
  );
  const [lines, setLines] = useState(
    draft.lines.map((l) => ({
      asText: l.asText,
      quantity: String(l.quantity ?? ""),
      unit: l.unit ?? "",
      food: l.food ?? "",
      note: l.note,
    }))
  );
  const [nutritionSource, setNutritionSource] = useState(
    draft.importState.nutrition
  );
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const setLine = (i: number, patch: Partial<(typeof lines)[number]>) => {
    setLines((all) => all.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  };

  const anyMacro = Object.values(nutrition).some((v) => v.trim() !== "");
  const nutritionLabel = anyMacro
    ? SOURCE_LABELS[nutritionSource ?? "source"]
    : "Missing";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setSaved(false);
    startTransition(async () => {
      const result = await saveReviewAction({
        slug: draft.slug,
        servings: toNumber(servings) as number,
        nutrition: Object.fromEntries(
          MACROS.map((m) => [m.key, toNumber(nutrition[m.key])])
        ) as Record<(typeof MACROS)[number]["key"], number | null>,
        lines: lines.map((l, i) => {
          const asText = l.asText || l.food.trim() === "";
          return {
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
      setSaved(true);
    });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">{draft.name}</h1>
        <p className="mt-1 flex gap-4 text-sm">
          {draft.sourceUrl && (
            <a
              href={draft.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Source
            </a>
          )}
          {draft.mealieUrl && (
            <a
              href={draft.mealieUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Open in Mealie
            </a>
          )}
        </p>
      </div>

      <label className="block">
        <span className="text-sm text-muted">Servings</span>
        <input
          type="number"
          inputMode="decimal"
          step="any"
          value={servings}
          onChange={(e) => setServings(e.target.value)}
          className={input}
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
                type="number"
                inputMode="decimal"
                step="any"
                value={nutrition[m.key]}
                onChange={(e) =>
                  setNutrition((n) => ({ ...n, [m.key]: e.target.value }))
                }
                className={input}
              />
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
                  <p className="mb-2 text-sm text-danger">Check this line</p>
                )}
                {!state.asText && (
                  <div className="grid grid-cols-3 gap-2">
                    <label className="block">
                      <span className="text-sm text-muted">Amount</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={state.quantity}
                        onChange={(e) =>
                          setLine(i, { quantity: e.target.value })
                        }
                        className={input}
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm text-muted">Unit</span>
                      <input
                        value={state.unit}
                        onChange={(e) => setLine(i, { unit: e.target.value })}
                        className={input}
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm text-muted">Food</span>
                      <input
                        value={state.food}
                        onChange={(e) => setLine(i, { food: e.target.value })}
                        className={input}
                      />
                    </label>
                  </div>
                )}
                <label className="mt-2 block">
                  <span className="text-sm text-muted">Note</span>
                  <input
                    value={state.note}
                    onChange={(e) => setLine(i, { note: e.target.value })}
                    className={input}
                  />
                </label>
                <label className="mt-2 flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={state.asText}
                    onChange={(e) => setLine(i, { asText: e.target.checked })}
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
      {saved && <output className="block text-sm">Saved</output>}
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
