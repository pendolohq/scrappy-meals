"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

import { suggestMatchesAction } from "../actions";

export const SuggestButton = ({ canSuggest }: { canSuggest: boolean }) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; error: boolean }>();

  if (!canSuggest) {
    return null;
  }
  const run = () =>
    startTransition(async () => {
      const result = await suggestMatchesAction({});
      if (result.error !== undefined) {
        setMessage({ text: result.error, error: true });
        return;
      }
      setMessage({
        text: `Suggested ${result.suggested} of ${result.tried}.`,
        error: false,
      });
      router.refresh();
    });

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Button size="sm" onClick={run} disabled={pending}>
        <Sparkles className="size-4" aria-hidden />
        {pending ? "Matching…" : "Suggest matches"}
      </Button>
      {message && (
        <output
          className={
            message.error ? "text-sm text-danger" : "text-sm text-muted"
          }
        >
          {message.text}
        </output>
      )}
    </div>
  );
};
