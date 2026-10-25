"use client";

import { useState, useTransition } from "react";
import { CopyPlus } from "lucide-react";

import { copyLastWeekAction } from "@/app/(app)/week/actions";
import { Button } from "@/components/ui/button";

const meals = (n: number) => `${n} meal${n === 1 ? "" : "s"}`;

/**
 * Copies last week's meals into this week's empty slots, and says what it
 * skipped. What it copied, and its Undo, come from the change log (see
 * `UndoChange`), so they don't go stale after an undo.
 */
export const CopyLastWeek = ({ weekStart }: { weekStart: string }) => {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const copy = () =>
    startTransition(async () => {
      setError(undefined);
      const res = await copyLastWeekAction({ weekStart });
      if (res.error !== undefined) {
        setError(res.error);
        return;
      }
      // What was copied shows with its Undo, from the change log.
      setMessage(
        res.skipped > 0
          ? `Skipped ${meals(res.skipped)} where something is already planned.`
          : res.copied.length === 0
            ? "Nothing to copy."
            : undefined
      );
    });

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <Button variant="secondary" size="sm" disabled={pending} onClick={copy}>
        <CopyPlus className="size-4" aria-hidden />
        Copy last week
      </Button>
      <output className="text-muted">{message}</output>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  );
};
