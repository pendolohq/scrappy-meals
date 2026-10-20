"use client";

import { type FormEvent, startTransition, useActionState } from "react";
import { ArrowRight, Link2 } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/input";
import { cx } from "@/lib/cx";

import { importRecipeAction, type ImportFormState } from "./actions";

export const ImportForm = () => {
  const [state, action, pending] = useActionState<ImportFormState, FormData>(
    importRecipeAction,
    {}
  );
  // Submitted by hand rather than with <form action>: React resets a form
  // after its action, which would clear the URL after an error.
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(() => action(form));
  };
  return (
    <form onSubmit={submit} className="space-y-5">
      <Field label="Recipe URL">
        <span className="relative block">
          <Link2
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          {/* type="text": the browser's own URL check would block submit before
            our validation can explain what is wrong; inputMode="url" still
            brings up the URL keyboard on phones. */}
          <input
            name="url"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            required
            placeholder="https://"
            aria-invalid={state.error ? true : undefined}
            aria-describedby={state.error ? "import-error" : undefined}
            className={cx(inputClass, "pl-10")}
          />
        </span>
      </Field>
      {state.error && (
        <p
          id="import-error"
          role="alert"
          className="rounded-control bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          {state.error}
        </p>
      )}
      {state.exists && (
        <output className="block rounded-control bg-accent-soft px-4 py-3 text-sm">
          <Link
            href={`/recipes/${encodeURIComponent(state.exists.slug)}/review`}
            className="inline-flex items-center gap-1.5 font-medium text-accent-ink underline-offset-2 hover:underline"
          >
            Already imported: {state.exists.name}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </output>
      )}
      <Button type="submit" size="lg" block disabled={pending}>
        {pending ? "Importing…" : "Import recipe"}
      </Button>
    </form>
  );
};
