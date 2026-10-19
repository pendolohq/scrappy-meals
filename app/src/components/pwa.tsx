"use client";

import { useEffect, useState } from "react";

/** Registers the service worker (production only) and shows a banner while offline. */
export const Pwa = () => {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("service worker:", err));
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

  if (!offline) return null;
  return (
    <output className="sticky top-0 block z-10 bg-danger px-4 py-1.5 text-center text-sm text-white">
      Offline: showing the last saved copy. Changes won&apos;t save until you&apos;re back online.
    </output>
  );
};

/** Asks the service worker to drop cached pages (call on sign-out). */
export const clearCachedPages = () => {
  navigator.serviceWorker?.controller?.postMessage("clear-pages");
};
