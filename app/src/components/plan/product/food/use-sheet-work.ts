"use client";

import { useState, useTransition } from "react";

import { failureText } from "../../attempt";

/** The sheet's one thing at a time: whether it's running, and what failed last. */
export const useSheetWork = () => {
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const run = (work: () => Promise<void>) =>
    startTransition(async () => {
      setError(undefined);
      await work();
    });

  const fail = (failure: Parameters<typeof failureText>[0]) =>
    setError(failureText(failure));

  return { error, pending, run, fail };
};

export type SheetWork = ReturnType<typeof useSheetWork>;
