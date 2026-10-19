"use client";

import { useActionState } from "react";

import { pushShoppingAction, type PushState } from "./actions";

export function PushButton({
  weekStart,
  disabled,
  pushedBefore,
}: {
  weekStart: string;
  disabled: boolean;
  pushedBefore: boolean;
}) {
  const [state, action, pending] = useActionState<PushState, FormData>(
    pushShoppingAction,
    {},
  );
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="weekStart" value={weekStart} />
      <button
        type="submit"
        disabled={pending || disabled}
        className="w-full rounded-lg bg-accent px-4 py-2 font-medium text-white disabled:opacity-60 dark:text-stone-900"
      >
        {pending
          ? "Sending to Mealie…"
          : pushedBefore
            ? "Update list in Mealie"
            : "Send to Mealie"}
      </button>
      {pushedBefore && !state.ok && (
        <p className="text-xs text-muted">
          Updating replaces what the planner added last time. Items you added in
          Mealie stay.
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="text-sm" role="status">
          Added {state.ok.added} item{state.ok.added === 1 ? "" : "s"} to “
          {state.ok.listName}”
          {state.ok.replaced ? `, replacing ${state.ok.replaced}` : ""}.{" "}
          {state.ok.url && (
            <a
              href={state.ok.url}
              className="text-accent underline"
              target="_blank"
              rel="noreferrer"
            >
              Open in Mealie
            </a>
          )}
        </p>
      )}
    </form>
  );
}
