"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { parseDecimal, THREE_DIGIT_GROUP } from "@/server/domain/decimal";
import {
  MACRO_KEYS,
  type MacroKey,
  type Macros,
} from "@/server/mealie/nutrition";

import { saveDecisionAction } from "../actions";
import { MACRO_LABELS } from "../labels";

export const DecisionForm = ({
  slug,
  usda,
}: {
  slug: string;
  usda: Partial<Macros>;
}) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [texts, setTexts] = useState(
    Object.fromEntries(MACRO_KEYS.map((m) => [m, String(usda[m] ?? "")]))
  );

  const save = (
    decision:
      | { choice: "mealie" | "usda" }
      | { choice: "edited"; values: Partial<Macros> }
  ) => {
    setError(undefined);
    startTransition(async () => {
      const result = await saveDecisionAction({ slug, ...decision });
      if (result.error !== undefined) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  const saveEdited = () => {
    const values: Partial<Macros> = {};
    for (const m of MACRO_KEYS) {
      const text = texts[m].trim();
      if (text === "") {
        continue;
      }
      const value = parseDecimal(text, THREE_DIGIT_GROUP[m]);
      if (value === null) {
        setError(`${MACRO_LABELS[m]} must be a number, 0 or more.`);
        return;
      }
      values[m] = value;
    }
    if (Object.keys(values).length === 0) {
      setError("Enter at least one value.");
      return;
    }
    save({ choice: "edited", values });
  };

  return (
    <div className="space-y-4 border-t border-border/70 pt-4">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => save({ choice: "mealie" })}
          disabled={pending}
        >
          Keep Mealie&rsquo;s
        </Button>
        <Button onClick={() => save({ choice: "usda" })} disabled={pending}>
          Use USDA&rsquo;s
        </Button>
        <Button
          variant="ghost"
          onClick={() => setEditing((e) => !e)}
          disabled={pending}
          aria-expanded={editing}
        >
          Edit
        </Button>
      </div>
      {editing && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            saveEdited();
          }}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {MACRO_KEYS.map((m: MacroKey) => (
              <Field
                key={m}
                label={`${MACRO_LABELS[m]} (${m === "kcal" ? "kcal" : "g"})`}
              >
                <Input
                  inputMode="decimal"
                  value={texts[m]}
                  onChange={(e) =>
                    setTexts((t) => ({ ...t, [m]: e.target.value }))
                  }
                />
              </Field>
            ))}
          </div>
          <Button type="submit" disabled={pending}>
            Save these values
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
};
