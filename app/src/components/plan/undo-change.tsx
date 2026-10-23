"use client";

import { useState, useTransition } from "react";
import { Undo2 } from "lucide-react";

import { undoChangeAction } from "@/app/(app)/week/actions";
import { Button } from "@/components/ui/button";

/**
 * The week's latest change with an Undo. It comes from the server, so it
 * survives a reload and shows on other devices; after an undo the page
 * revalidates and offers the change before it, if any.
 */
export const UndoChange = ({
  changeId,
  summary,
  byName,
}: {
  changeId: string;
  summary: string;
  byName: string | null;
}) => {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  const undo = () =>
    startTransition(async () => {
      setError(undefined);
      const res = await undoChangeAction({ changeId });
      if (res.error !== undefined) {
        setError(res.error);
      }
    });

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="text-muted">
        {byName ? `${byName}: ` : ""}
        {summary}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2"
        disabled={pending}
        onClick={undo}
      >
        <Undo2 className="size-4" aria-hidden />
        Undo
      </Button>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  );
};
