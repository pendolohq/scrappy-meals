"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { saveTimeZone } from "@/lib/time-zone";

/**
 * Tells the server the device's time zone, and re-renders the page when it
 * changes: on first load, and on coming back to the app after travelling.
 * Mounted on the login page too, so the first week after signing in is
 * already the device's.
 */
export const TimeZoneSync = () => {
  const router = useRouter();
  useEffect(() => {
    const sync = () => {
      if (document.visibilityState === "visible" && saveTimeZone()) {
        router.refresh();
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [router]);
  return null;
};
