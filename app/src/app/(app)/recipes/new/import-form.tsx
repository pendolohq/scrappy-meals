"use client";

import { useActionState } from "react";
import Link from "next/link";

import { importRecipeAction, type ImportState } from "./actions";

export const ImportForm = () => {
  const [state, action, pending] = useActionState<ImportState, FormData>(
    async (prev, form) => {
      const result = await importRecipeAction(prev, form);
      return "error" in result && result.error
        ? { error: result.error }
        : { exists: "exists" in result ? result.exists : undefined };
    },
    {}
  );
  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className="text-sm text-muted">Recipe URL</span>
        <input
          name="url"
          type="text"
          inputMode="url"
          autoComplete="off"
          required
          placeholder="https://"
          className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2"
        />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.exists && (
        <p className="text-sm">
          <Link
            href={`/recipes/${encodeURIComponent(state.exists.slug)}/review`}
            className="font-medium underline"
          >
            Already imported: {state.exists.name}
          </Link>
        </p>
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
