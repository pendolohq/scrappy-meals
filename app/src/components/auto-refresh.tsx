"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Picks up the other person's changes: refreshes on coming back to the tab and every `seconds` while visible. */
export const AutoRefresh = ({ seconds = 30 }: { seconds?: number }) => {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    };
    const timer = setInterval(refresh, seconds * 1000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, seconds]);
  return null;
};
