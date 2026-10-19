"use client";

import { type FormEvent, startTransition, useActionState } from "react";

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

const input = "mt-1 w-full rounded-lg border border-border bg-card px-3 py-2";

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
    <form onSubmit={submit} className="space-y-6">
      <label className="block">
        <span className="text-sm text-muted">Name</span>
        <input
          name="name"
          defaultValue={profile.name}
          required
          maxLength={80}
          className={input}
        />
      </label>

      <fieldset>
        <legend className="mb-2 font-medium">Daily targets</legend>
        <p className="mb-3 text-sm text-muted">
          Leave a field empty to not track it.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {TARGETS.map((t) => (
            <label key={t.name} className="block">
              <span className="text-sm text-muted">
                {t.label} ({t.unit})
              </span>
              <input
                name={t.name}
                type="number"
                inputMode="decimal"
                min="0"
                max={t.max}
                step={t.step}
                defaultValue={profile[t.name] ?? ""}
                className={input}
              />
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 font-medium">Fasting days</legend>
        <p className="mb-3 text-sm text-muted">
          Meals added on these weekdays start with your portion at 0, and your
          targets are hidden. Changing them also applies to past weeks, and
          doesn&apos;t change meals already planned. Single days can still be
          changed in the plan.
        </p>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((day, i) => (
            <label
              key={day}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2"
            >
              <input
                type="checkbox"
                name="fastingDays"
                value={i + 1}
                defaultChecked={profile.defaultFastingDays.includes(i + 1)}
              />
              <span className="text-sm">{day}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.ok && <p className="text-sm text-accent">Saved.</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-accent px-4 py-2 font-medium text-white disabled:opacity-60 dark:text-stone-900"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
};
