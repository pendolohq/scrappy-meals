"use client";

import { useState, useTransition } from "react";
import { Undo2 } from "lucide-react";

import { undoChangeAction } from "@/app/(app)/week/actions";
import { Button } from "@/components/ui/button";

/**
 * The week's latest change with an Undo. It comes from the server, so it
 * survives a reload and shows on other devices; after an undo the page
 * revalidates and offers the change before it, if any, while this keeps
 * saying what the undo did.
 */
export const UndoChange = ({
  change,
}: {
  change: { id: string; summary: string; byName: string | null } | null;
}) => {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  if (!change && !message && !error) {
    return null;
  }

  const undo = (changeId: string) =>
    startTransition(async () => {
      setError(undefined);
      setMessage(undefined);
      const res = await undoChangeAction({ changeId });
      if (res.error !== undefined) {
        setError(res.error);
        return;
      }
      setMessage(res.message);
    });

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <output className="text-muted">{message}</output>
      {change && (
        <>
          <span className="text-muted">
            {change.byName ? `${change.byName}: ` : ""}
            {change.summary}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2"
            disabled={pending}
            onClick={() => undo(change.id)}
          >
            <Undo2 className="size-4" aria-hidden />
            Undo
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  );
};
