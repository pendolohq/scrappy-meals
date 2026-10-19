"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Picks up the other person's changes: refreshes on focus and every `seconds` while visible. */
export const AutoRefresh = ({ seconds = 30 }: { seconds?: number }) => {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    };
    const timer = setInterval(refresh, seconds * 1000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, seconds]);
  return null;
};
