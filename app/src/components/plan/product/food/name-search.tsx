"use client";

import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import type { RecipeListItem } from "@/server/mealie/recipes";

/** The food's name, and the foods added before under it. */
export const NameSearch = ({
  name,
  onName,
  searched,
  recipes,
  pending,
  onFind,
  onOpen,
}: {
  name: string;
  onName: (name: string) => void;
  /** A search has come back. */
  searched: boolean;
  recipes: RecipeListItem[];
  pending: boolean;
  onFind: () => void;
  onOpen: (slug: string) => void;
}) => {
  const field = useRef<HTMLInputElement>(null);

  // Opened from "Add it by name": the name is what comes next.
  useEffect(() => {
    field.current?.focus();
  }, []);

  return (
    <>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          onFind();
        }}
      >
        <Field label="Name" hint="A kiwi, a glass of milk, a cappuccino.">
          <Input
            ref={field}
            autoComplete="off"
            value={name}
            maxLength={120}
            onChange={(e) => onName(e.target.value)}
            placeholder="Kiwi"
          />
        </Field>
        <Button
          type="submit"
          block
          variant={searched ? "secondary" : "primary"}
          disabled={pending || name.trim() === ""}
        >
          {pending && !searched ? "Looking…" : "Find"}
        </Button>
      </form>

      {recipes.length > 0 && (
        <section className="space-y-1" aria-label="Added before">
          <h3 className="text-sm font-medium text-muted">Added before</h3>
          <ul>
            {recipes.map((r) => (
              <li key={r.slug}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onOpen(r.slug)}
                  className="flex min-h-tap w-full items-center rounded-button px-2 text-left font-serif font-semibold transition hover:bg-sunken disabled:opacity-60"
                >
                  {r.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
};
