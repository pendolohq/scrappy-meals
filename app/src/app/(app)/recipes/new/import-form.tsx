"use client";

import {
  type FormEvent,
  startTransition,
  useActionState,
  useState,
} from "react";
import { ArrowRight, Link2 } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/input";
import { cx } from "@/lib/cx";
import { isSocialPostUrl } from "@/server/domain/recipe-url";
import { screenshotProblem } from "@/server/domain/screenshots";

import { importRecipeAction, type ImportFormState } from "./actions";

export const ImportForm = () => {
  const [state, action, pending] = useActionState<ImportFormState, FormData>(
    importRecipeAction,
    {}
  );
  const [url, setUrl] = useState("");
  const social = isSocialPostUrl(url);
  // Checked on pick: an upload over the body limit fails before the action
  // can say what is wrong.
  const [imageError, setImageError] = useState<string | null>(null);
  const shownImageError = social ? imageError : null;
  const error = shownImageError ?? state.error;
  // Submitted by hand rather than with <form action>: React resets a form
  // after its action, which would clear the URL after an error.
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (shownImageError) {
      return;
    }
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
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              // The file input goes away with a non-post URL, and the files
              // with it; its error must not come back with a new, empty one.
              if (!isSocialPostUrl(e.target.value)) {
                setImageError(null);
              }
            }}
            placeholder="https://"
            aria-invalid={state.error && !shownImageError ? true : undefined}
            aria-describedby={
              state.error && !shownImageError ? "import-error" : undefined
            }
            className={cx(inputClass, "pl-10")}
          />
        </span>
      </Field>
      {/* Rendered only for a post, not hidden: a hidden field would still be
        submitted, and its caption and files must not reach a web import. */}
      {social && (
        <>
          {/* Hints are separate from Field's `hint`, which sits inside the
            <label> and would become part of the field's accessible name. */}
          <div className="space-y-1.5">
            <Field label="Caption">
              <textarea
                name="caption"
                rows={6}
                aria-describedby="caption-hint"
                className={cx(inputClass, "py-2.5")}
              />
            </Field>
            <p id="caption-hint" className="text-xs text-muted">
              Instagram and Facebook don&apos;t let Mealie read posts: paste the
              post&apos;s caption here, or add screenshots.
            </p>
          </div>
          <div className="space-y-1.5">
            <Field label="Screenshots">
              <input
                name="images"
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) =>
                  setImageError(screenshotProblem([...(e.target.files ?? [])]))
                }
                aria-invalid={shownImageError ? true : undefined}
                aria-describedby={
                  shownImageError
                    ? "screenshots-hint import-error"
                    : "screenshots-hint"
                }
                className={cx(inputClass, "py-2")}
              />
            </Field>
            <p id="screenshots-hint" className="text-xs text-muted">
              Up to 4 images, 4 MB each.
            </p>
          </div>
        </>
      )}
      {error && (
        <p
          id="import-error"
          role="alert"
          className="rounded-control bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          {error}
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
        {pending
          ? social
            ? "Reading the post…"
            : "Importing…"
          : "Import recipe"}
      </Button>
      {pending && social && (
        <p className="text-center text-sm text-muted">
          This can take up to a minute.
        </p>
      )}
    </form>
  );
};
