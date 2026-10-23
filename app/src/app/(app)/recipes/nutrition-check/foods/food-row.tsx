"use client";

import { useState, useTransition } from "react";
import { Check, PencilLine, Search } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { parseDecimal } from "@/server/domain/decimal";
import type { UsdaHit, UsdaPortion } from "@/server/domain/usda";
import { MACRO_KEYS, type Macros } from "@/server/mealie/nutrition";

import {
  confirmMatchAction,
  saveOwnValuesAction,
  searchUsdaAction,
} from "../actions";
import { MACRO_LABELS } from "../labels";

type Match = {
  status: "suggested" | "confirmed";
  fdcId: number;
  description: string;
  dataType: string;
  kcalPer100g: number | null;
  per100g: Partial<Macros>;
  portions: UsdaPortion[];
  pieceGrams: number | null;
  pieceLabel: string | null;
  unitGrams: Record<string, number>;
  defaultGrams: number | null;
};

type Unit = { key: string; name: string };

// The USDA portion named like the unit ("1 clove"), shown as a hint.
const usdaPortion = (portions: UsdaPortion[], unit: Unit) =>
  portions.find((p) => {
    const m = p.measure.trim().toLowerCase();
    return m === unit.key || m === unit.name.toLowerCase();
  });

const grams = (n: number) => String(Math.round(n * 100) / 100);

export const FoodRow = ({
  food,
  match,
}: {
  food: {
    id: string;
    name: string;
    uses: number;
    lines: string[];
    units: Unit[];
    unmeasured: number;
  };
  match: Match | null;
}) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [searching, setSearching] = useState(false);
  const own = match?.dataType === "Own values";
  const [entering, setEntering] = useState(false);
  const [ownText, setOwnText] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      MACRO_KEYS.map((m) => {
        const v = own ? match.per100g[m] : undefined;
        return [m, v === undefined ? "" : String(v)];
      })
    )
  );
  const [tbspText, setTbspText] = useState(() => {
    const tbsp = own ? match.portions.find((p) => p.measure === "tbsp") : null;
    return tbsp ? grams(tbsp.grams) : "";
  });
  const [query, setQuery] = useState(food.name);
  const [hits, setHits] = useState<UsdaHit[]>();
  const [pieceText, setPieceText] = useState(
    match?.pieceGrams ? grams(match.pieceGrams) : ""
  );
  // What the weight was picked from; typing a different one drops it.
  const [pieceLabel, setPieceLabel] = useState(match?.pieceLabel ?? null);

  const [unitText, setUnitText] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      food.units.map((u) => {
        const g = match?.unitGrams[u.key];
        return [u.key, g ? grams(g) : ""];
      })
    )
  );

  const [defaultText, setDefaultText] = useState(
    match?.defaultGrams ? grams(match.defaultGrams) : ""
  );
  const defaultGrams =
    defaultText.trim() === "" ? null : parseDecimal(defaultText, "refuse");
  const defaultInvalid = defaultText.trim() !== "" && defaultGrams === null;

  const piece =
    pieceText.trim() === "" ? null : parseDecimal(pieceText, "refuse");
  const pieceInvalid = pieceText.trim() !== "" && piece === null;
  const unitValues = food.units.map((u) => {
    const text = (unitText[u.key] ?? "").trim();
    const value = text === "" ? null : parseDecimal(text, "refuse");
    return { ...u, value, invalid: text !== "" && value === null };
  });

  const confirm = (fdcId: number) => {
    if (pieceInvalid || defaultInvalid || unitValues.some((u) => u.invalid)) {
      setError("Each weight must be a number of grams.");
      return;
    }
    const unitGrams = Object.fromEntries(
      unitValues.flatMap((u) => (u.value === null ? [] : [[u.key, u.value]]))
    );
    setError(undefined);
    // A weight picked from one USDA food's portions isn't another's.
    const carry = fdcId === match?.fdcId || pieceLabel === null;
    startTransition(async () => {
      const result = await confirmMatchAction({
        foodId: food.id,
        fdcId,
        pieceGrams: carry ? piece : null,
        pieceLabel: carry && piece !== null ? pieceLabel : null,
        unitGrams,
        defaultGrams,
      });
      if (result.error !== undefined) {
        setError(result.error);
        return;
      }
      setSearching(false);
      setHits(undefined);
      router.refresh();
    });
  };

  const saveOwn = () => {
    const per100g = Object.fromEntries(
      MACRO_KEYS.map((m) => [m, parseDecimal(ownText[m] ?? "", "refuse")])
    );
    const tbsp =
      tbspText.trim() === "" ? null : parseDecimal(tbspText, "refuse");
    if (
      MACRO_KEYS.some((m) => per100g[m] === null) ||
      (tbspText.trim() !== "" && tbsp === null) ||
      pieceInvalid ||
      defaultInvalid ||
      unitValues.some((u) => u.invalid)
    ) {
      setError("Each value must be a number.");
      return;
    }
    setError(undefined);
    startTransition(async () => {
      const result = await saveOwnValuesAction({
        foodId: food.id,
        per100g: per100g as Macros,
        gramsPerTbsp: tbsp,
        pieceGrams: piece,
        defaultGrams,
        unitGrams: Object.fromEntries(
          unitValues.flatMap((u) =>
            u.value === null ? [] : [[u.key, u.value]]
          )
        ),
      });
      if (result.error !== undefined) {
        setError(result.error);
        return;
      }
      setEntering(false);
      router.refresh();
    });
  };

  const search = () => {
    setError(undefined);
    startTransition(async () => {
      const result = await searchUsdaAction({ query });
      if (result.error !== undefined) {
        setError(result.error);
        return;
      }
      setHits(result.hits);
    });
  };

  return (
    <Card className="space-y-3">
      <div className="space-y-0.5">
        <h3 className="font-medium">
          {food.name}{" "}
          <span className="text-sm font-normal text-muted">
            · {food.uses} {food.uses === 1 ? "line" : "lines"}
          </span>
        </h3>
        {food.lines.length > 0 && (
          <p className="text-sm text-muted">{food.lines.join(" · ")}</p>
        )}
      </div>

      {match && (
        <div className="space-y-3 rounded-button bg-sunken/70 p-3">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{match.description}</span>
            <Pill>{match.dataType}</Pill>
            {match.kcalPer100g !== null && (
              <span className="text-muted">
                {Math.round(match.kcalPer100g)} kcal per 100 g
              </span>
            )}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {match.portions.length > 0 && (
              <Field label="Portion for one">
                <select
                  className="block min-h-tap w-full rounded-button border border-border-strong bg-card px-3 text-base"
                  value={match.portions.findIndex(
                    (p) => p.label === pieceLabel
                  )}
                  onChange={(e) => {
                    const p = match.portions[Number(e.target.value)];
                    setPieceText(p ? grams(p.grams) : "");
                    setPieceLabel(p?.label ?? null);
                  }}
                >
                  <option value={-1}>None</option>
                  {match.portions.map((p, i) => (
                    <option key={`${p.label}-${i}`} value={i}>
                      {p.label} ({grams(p.grams)} g each)
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Or type the weight of one (g)">
              <Input
                inputMode="decimal"
                value={pieceText}
                aria-invalid={pieceInvalid || undefined}
                onChange={(e) => {
                  setPieceText(e.target.value);
                  setPieceLabel(null);
                }}
              />
            </Field>
          </div>
          <p className="text-xs text-muted">
            Used for lines with no unit, like &ldquo;2 kiwis&rdquo;.
          </p>
          {food.unmeasured > 0 && (
            <Field label="Amount when a line gives none (g)">
              <Input
                inputMode="decimal"
                value={defaultText}
                placeholder="Not counted"
                aria-invalid={defaultInvalid || undefined}
                onChange={(e) => setDefaultText(e.target.value)}
              />
            </Field>
          )}
          {unitValues.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {unitValues.map((u) => {
                const portion = usdaPortion(match.portions, u);
                return (
                  <Field key={u.key} label={`Weight of one ${u.name} (g)`}>
                    <Input
                      inputMode="decimal"
                      value={unitText[u.key] ?? ""}
                      placeholder={
                        portion ? `USDA: ${grams(portion.grams)}` : undefined
                      }
                      aria-invalid={u.invalid || undefined}
                      onChange={(e) =>
                        setUnitText((t) => ({ ...t, [u.key]: e.target.value }))
                      }
                    />
                  </Field>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {match && (
          <Button
            size="sm"
            onClick={() => confirm(match.fdcId)}
            disabled={pending}
          >
            <Check className="size-4" aria-hidden />
            {match.status === "suggested" ? "Confirm" : "Save weights"}
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setSearching((s) => !s)}
          aria-expanded={searching}
        >
          <Search className="size-4" aria-hidden />
          {match ? "Search another" : "Search USDA"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setEntering((e) => !e)}
          aria-expanded={entering}
        >
          <PencilLine className="size-4" aria-hidden />
          {own ? "Edit values" : "Enter values"}
        </Button>
      </div>

      {entering && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            saveOwn();
          }}
        >
          <p className="text-sm text-muted">
            For a food USDA doesn&rsquo;t have: copy the values per 100 g from
            its label.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {MACRO_KEYS.map((m) => (
              <Field
                key={m}
                label={`${MACRO_LABELS[m]} per 100 g (${m === "kcal" ? "kcal" : "g"})`}
              >
                <Input
                  inputMode="decimal"
                  value={ownText[m] ?? ""}
                  onChange={(e) =>
                    setOwnText((t) => ({ ...t, [m]: e.target.value }))
                  }
                />
              </Field>
            ))}
            <Field label="Weight of 1 tbsp (g)">
              <Input
                inputMode="decimal"
                value={tbspText}
                onChange={(e) => setTbspText(e.target.value)}
              />
            </Field>
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            <Check className="size-4" aria-hidden />
            Save values
          </Button>
        </form>
      )}

      {searching && (
        <div className="space-y-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              search();
            }}
          >
            <Input
              aria-label={`Search USDA for ${food.name}`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="In English, such as tomatoes, canned"
            />
            <Button type="submit" variant="secondary" disabled={pending}>
              Search
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
                    onClick={() => confirm(hit.fdcId)}
                    disabled={pending}
                  >
                    Use
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </Card>
  );
};
