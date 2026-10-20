"use client";

import { type FormEvent, startTransition, useActionState } from "react";
import Link from "next/link";

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
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="text-sm text-muted">Recipe URL</span>
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
          className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2"
        />
      </label>
      {state.error && (
        <p id="import-error" role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.exists && (
        <output className="block text-sm">
          <Link
            href={`/recipes/${encodeURIComponent(state.exists.slug)}/review`}
            className="font-medium underline"
          >
            Already imported: {state.exists.name}
          </Link>
        </output>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-accent px-3 py-2 font-medium text-white disabled:opacity-60 dark:text-stone-900"
      >
        {pending ? "Importing…" : "Import recipe"}
      </button>
    </form>
  );
};
