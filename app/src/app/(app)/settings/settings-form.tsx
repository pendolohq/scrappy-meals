"use client";

import { type FormEvent, startTransition, useActionState } from "react";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, inputClass } from "@/components/ui/input";
import { cx } from "@/lib/cx";
import type { ProfileInput } from "@/server/users";

import { saveSettings, type SettingsState } from "./actions";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const TARGETS = [
  // `max` matches profileSchema in server/users.ts.
  {
    name: "targetKcal",
    label: "Calories",
    unit: "kcal",
    step: "1",
    max: 20_000,
  },
  {
    name: "targetProteinG",
    label: "Protein",
    unit: "g",
    step: "0.1",
    max: 1_000,
  },
  { name: "targetCarbsG", label: "Carbs", unit: "g", step: "0.1", max: 2_000 },
  { name: "targetFatG", label: "Fat", unit: "g", step: "0.1", max: 1_000 },
  { name: "targetFibreG", label: "Fibre", unit: "g", step: "0.1", max: 500 },
] as const;

export const SettingsForm = ({ profile }: { profile: ProfileInput }) => {
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    saveSettings,
    {}
  );

  // Submitted by hand rather than with <form action>: React resets a form
  // after its action, which would undo every edit when one field is invalid.
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(() => action(form));
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Card>
        <Field label="Name">
          <input
            name="name"
            defaultValue={profile.name}
            required
            maxLength={80}
            className={inputClass}
          />
        </Field>
      </Card>

      <Card as="fieldset">
        <legend className="sr-only">Daily targets</legend>
        <h2 aria-hidden className="font-serif text-heading font-semibold">
          Daily targets
        </h2>
        <p className="mt-1 mb-4 text-sm text-muted">
          Leave a field empty to not track it.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {TARGETS.map((t) => (
            <Field key={t.name} label={`${t.label} (${t.unit})`}>
              <input
                name={t.name}
                type="number"
                inputMode="decimal"
                min="0"
                max={t.max}
                step={t.step}
                defaultValue={profile[t.name] ?? ""}
                className={cx(inputClass, "tabular-nums")}
              />
            </Field>
          ))}
        </div>
      </Card>

      <Card as="fieldset">
        <legend className="sr-only">Fasting days</legend>
        <h2 aria-hidden className="font-serif text-heading font-semibold">
          Fasting days
        </h2>
        <p className="mt-1 mb-4 text-sm text-muted">
          Meals added on these weekdays start with your portion at 0, and your
          targets are hidden. Changing them also applies to past weeks, and
          doesn&apos;t change meals already planned. Single days can still be
          changed in the plan.
        </p>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((day, i) => (
            <label
              key={day}
              className="relative flex min-h-tap cursor-pointer items-center gap-1.5 rounded-full border border-border-strong bg-card px-4 text-sm font-medium transition hover:bg-sunken has-checked:border-accent has-checked:bg-accent has-checked:text-accent-foreground has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent"
            >
              <input
                type="checkbox"
                name="fastingDays"
                value={i + 1}
                defaultChecked={profile.defaultFastingDays.includes(i + 1)}
                className="peer sr-only"
              />
              <Check className="hidden size-4 peer-checked:block" aria-hidden />
              {day}
            </label>
          ))}
        </div>
      </Card>

      {state.error && (
        <p
          role="alert"
          className="rounded-control bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          {state.error}
        </p>
      )}
      <div className="flex items-center gap-4">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {state.ok && (
          <p className="flex items-center gap-1.5 text-sm font-medium text-accent">
            <Check className="size-4" aria-hidden />
            Saved.
          </p>
        )}
      </div>
    </form>
  );
};
