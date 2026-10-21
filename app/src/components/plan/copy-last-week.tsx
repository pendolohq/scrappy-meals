"use client";

import { useState, useTransition } from "react";
import { CopyPlus, Undo2 } from "lucide-react";

import { copyLastWeekAction, undoCopyAction } from "@/app/(app)/week/actions";
import { Button } from "@/components/ui/button";

const meals = (n: number) => `${n} meal${n === 1 ? "" : "s"}`;

/**
 * Copies last week's meals into this week's empty slots, then says how many
 * it copied and skipped, with an Undo until the next copy or reload.
 */
export const CopyLastWeek = ({ weekStart }: { weekStart: string }) => {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState<string[]>([]);

  const copy = () =>
    startTransition(async () => {
      setError(undefined);
      const res = await copyLastWeekAction({ weekStart });
      if (res.error !== undefined) {
        setError(res.error);
        return;
      }
      setCopied(res.copied);
      const skipped =
        res.skipped > 0
          ? `${res.copied.length > 0 ? "; skipped" : "Skipped"} ${meals(res.skipped)} where something is already planned`
          : "";
      setMessage(
        res.copied.length > 0
          ? `Copied ${meals(res.copied.length)}${skipped}.`
          : `${skipped || "Nothing to copy"}.`
      );
    });

  const undo = () =>
    startTransition(async () => {
      setError(undefined);
      const res = await undoCopyAction({ mealIds: copied });
      if (res.error) {
        setError(res.error);
        return;
      }
      setCopied([]);
      setMessage(`Removed the ${meals(copied.length)} copied from last week.`);
    });

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <Button variant="secondary" size="sm" disabled={pending} onClick={copy}>
        <CopyPlus className="size-4" aria-hidden />
        Copy last week
      </Button>
      <output className="text-muted">{message}</output>
      {copied.length > 0 && (
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
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  );
};
