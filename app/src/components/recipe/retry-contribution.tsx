"use client";

import { useState, useTransition } from "react";

import { retryContributionAction } from "@/app/(app)/recipes/[slug]/actions";
import { attempt, failureText } from "@/components/plan/attempt";
import { Button } from "@/components/ui/button";

export const RetryContribution = ({ barcode }: { barcode: string }) => {
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();

  const retry = () =>
    startTransition(async () => {
      setMessage(undefined);
      const res = await attempt(() => retryContributionAction({ barcode }));
      if (!("outcome" in res)) {
        setMessage(failureText(res));
      } else if (res.outcome === "failed") {
        setMessage("Still not sent. Try again in a while.");
      } else if (res.outcome === "disabled") {
        setMessage("Sending to Open Food Facts is switched off.");
      }
    });

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted">Not sent to Open Food Facts yet.</span>
      <Button variant="secondary" size="sm" disabled={pending} onClick={retry}>
        {pending ? "Retrying…" : "Retry"}
      </Button>
      {message && (
        <span role="alert" className="text-danger">
          {message}
        </span>
      )}
    </div>
  );
};
