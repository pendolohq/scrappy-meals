"use client";

import { useEffect, useState } from "react";

import { clearAllQueues } from "@/lib/shop-queue-store";

/** Registers the service worker (production only) and shows a banner while offline. */
export const Pwa = () => {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .catch((err) => console.warn("service worker:", err));
    }
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) {
    return null;
  }
  return (
    <output className="sticky top-0 z-10 block bg-danger px-4 py-1.5 text-center text-sm text-white">
      Offline: showing the last saved copy. Changes won&apos;t save until
      you&apos;re back online.
    </output>
  );
};

/**
 * On sign-out: asks the service worker to drop cached pages and clears queued
 * shop-list changes, so neither the plan nor the list stays on the device.
 */
export const clearCachedPages = () => {
  navigator.serviceWorker?.controller?.postMessage("clear-pages");
  clearAllQueues();
};
