"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import {
  loadProductAction,
  lookupProductAction,
} from "@/app/(app)/week/actions";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/input";
import { RecipeImage } from "@/components/ui/recipe-image";
import { parseBarcode } from "@/server/domain/barcode";
import type { ProductLookup } from "@/server/products";

import { attempt, failureText } from "./attempt";
import { ProductSheet, type Slot } from "./product-sheet";
import { useRecipeList } from "./use-recipe-list";

/**
 * The Add dialog's Product mode: type a barcode, or tap one of the latest
 * products. A barcode opens the sheet to check and add it.
 */
export const ProductTab = ({
  at,
  future,
  onAdded,
  initial,
}: {
  at: Slot;
  /** The day is after today, so nothing can have been eaten yet. */
  future: boolean;
  onAdded: () => void;
  /** A product picked elsewhere (recipe search): open its sheet straight away. */
  initial?: ProductLookup;
}) => {
  const [barcode, setBarcode] = useState("");
  const [lookup, setLookup] = useState(initial);
  const [problem, setProblem] = useState<string>();
  const [pending, startTransition] = useTransition();
  const field = useRef<HTMLInputElement>(null);
  const recent = useRecipeList("/api/recipes/search?products=1", !lookup);

  // Back from a sheet, the field is there again for the next barcode.
  useEffect(() => {
    if (!lookup) {
      field.current?.focus();
    }
  }, [lookup]);

  const find = () => {
    setProblem(undefined);
    if (!parseBarcode(barcode)) {
      setProblem(
        "That doesn't look like a barcode: it should be 8 to 14 digits"
      );
      return;
    }
    startTransition(async () => {
      const res = await attempt(() => lookupProductAction({ barcode }));
      if (res.error === undefined) {
        setLookup(res);
      } else {
        setProblem(failureText(res));
      }
    });
  };

  const open = (slug: string) =>
    startTransition(async () => {
      setProblem(undefined);
      const res = await attempt(() => loadProductAction({ slug }));
      if (res.error === undefined) {
        setLookup(res);
      } else {
        setProblem(failureText(res));
      }
    });

  if (lookup) {
    return (
      <div className="p-4">
        <ProductSheet
          lookup={lookup}
          at={at}
          future={future}
          onAdded={onAdded}
          onBack={() => setLookup(undefined)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          find();
        }}
      >
        <Field label="Barcode" hint="The 8 to 14 digits under the bars.">
          <input
            ref={field}
            inputMode="numeric"
            autoComplete="off"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            placeholder="5000159461122"
            className={inputClass}
          />
        </Field>
        <Button type="submit" block disabled={pending || barcode.trim() === ""}>
          {pending ? "Looking up…" : "Look up"}
        </Button>
        {problem && (
          <p role="alert" className="text-sm text-danger">
            {problem}
          </p>
        )}
      </form>

      {recent.items.length > 0 && (
        <section className="space-y-1" aria-label="Recent products">
          <h3 className="text-sm font-medium text-muted">Recent products</h3>
          <ul>
            {recent.items.map((r) => (
              <li key={r.slug}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => open(r.slug)}
                  className="flex w-full items-center gap-3 rounded-button p-2 text-left transition hover:bg-sunken disabled:opacity-60"
                >
                  <RecipeImage
                    mealieId={r.imagePath && r.id ? r.id : null}
                    className="size-12"
                  />
                  <span className="line-clamp-2 min-w-0 flex-1 font-serif font-semibold">
                    {r.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {recent.status === "error" && (
        <p className="text-sm text-danger">{recent.error}</p>
      )}
    </div>
  );
};
