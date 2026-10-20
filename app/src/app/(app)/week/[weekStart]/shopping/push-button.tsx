"use client";

import { useActionState } from "react";
import { RefreshCw, Send } from "lucide-react";

import { Button } from "@/components/ui/button";

import { pushShoppingAction, type PushState } from "./actions";

export const PushButton = ({
  weekStart,
  disabled,
  pushedBefore,
}: {
  weekStart: string;
  disabled: boolean;
  pushedBefore: boolean;
}) => {
  const [state, action, pending] = useActionState<PushState, FormData>(
    pushShoppingAction,
    {}
  );
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="weekStart" value={weekStart} />
      <Button type="submit" size="lg" block disabled={pending || disabled}>
        {pushedBefore ? (
          <RefreshCw className="size-4" aria-hidden />
        ) : (
          <Send className="size-4" aria-hidden />
        )}
        {pending
          ? "Sending to Mealie…"
          : pushedBefore
            ? "Update from plan"
            : "Send to Mealie"}
      </Button>
      {pushedBefore && !state.ok && (
        <p className="text-center text-xs text-muted">
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
        <output className="block rounded-control bg-highlight-soft px-4 py-3 text-sm font-medium text-highlight">
          Added {state.ok.added} item{state.ok.added === 1 ? "" : "s"} to “
          {state.ok.listName}”
          {state.ok.replaced ? `, replacing ${state.ok.replaced}` : ""}.
        </output>
      )}
      {state.ok && state.ok.merged > 0 && (
        <p className="rounded-control bg-danger-soft px-4 py-3 text-sm text-danger">
          {state.ok.merged === 1
            ? "1 item was added to a line already on the list in Mealie"
            : `${state.ok.merged} items were added to lines already on the list in Mealie`}
          . Check those quantities: sending the list again adds to them again.
        </p>
      )}
    </form>
  );
};
