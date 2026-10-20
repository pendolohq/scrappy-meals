"use client";

import { type FormEvent, useState, useTransition } from "react";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MAX_SNACK_SLOTS } from "@/server/domain/slots";

import { saveHouseholdAction } from "./actions";

const COUNTS = Array.from({ length: MAX_SNACK_SLOTS + 1 }, (_, i) => i);

export const HouseholdForm = ({ snackSlots }: { snackSlots: number }) => {
  const [value, setValue] = useState(snackSlots);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = await saveHouseholdAction({ snackSlots: value });
      setError(res.error);
      setSaved(!res.error);
    });
  };

  return (
    <form onSubmit={submit}>
      <Card as="fieldset">
        <legend className="sr-only">Household</legend>
        <h2 aria-hidden className="font-serif text-heading font-semibold">
          Household
        </h2>
        <p className="mt-1 text-sm text-muted">
          This applies to everyone, not just you.
        </p>
        <p className="mt-4 text-sm font-medium text-muted" id="snacks-label">
          Snacks a day
        </p>
        <div
          role="radiogroup"
          aria-labelledby="snacks-label"
          className="mt-1.5 flex flex-wrap gap-2"
        >
          {COUNTS.map((n) => (
            <label
              key={n}
              className="relative flex min-h-tap min-w-tap cursor-pointer items-center justify-center rounded-button border border-border-strong bg-card px-4 text-sm font-medium transition hover:bg-sunken has-checked:border-accent has-checked:bg-accent has-checked:text-accent-foreground has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent"
            >
              <input
                type="radio"
                name="snackSlots"
                value={n}
                checked={value === n}
                onChange={() => {
                  setValue(n);
                  setSaved(false);
                }}
                className="sr-only"
              />
              {n}
            </label>
          ))}
        </div>
        <p className="mt-3 text-sm text-muted">
          Snacks fill morning, afternoon, evening, then late night. Lowering the
          number keeps snacks already planned; they stay on their day, just
          without an add button.
        </p>
        {error && (
          <p
            role="alert"
            className="mt-3 rounded-control bg-danger-soft px-4 py-3 text-sm text-danger"
          >
            {error}
          </p>
        )}
        <div className="mt-4 flex items-center gap-4">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <output className="flex items-center gap-1.5 text-sm font-medium text-highlight">
            {saved && (
              <>
                <Check className="size-4" aria-hidden />
                Saved.
              </>
            )}
          </output>
        </div>
      </Card>
    </form>
  );
};
