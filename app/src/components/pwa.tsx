"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { listenForInstall } from "@/lib/install";
import { clearAllQueues } from "@/lib/shop-queue-store";

const swEnabled = () =>
  process.env.NODE_ENV === "production" && "serviceWorker" in navigator;

/**
 * Registers the service worker (production only), shows a banner while
 * offline, and offers a reload when a new version is waiting. The new worker
 * never takes over an open page by itself: its chunks belong to another build.
 */
export const Pwa = () => {
  const [offline, setOffline] = useState(false);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => listenForInstall(), []);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    if (!swEnabled()) {
      return;
    }
    let registration: ServiceWorkerRegistration | undefined;
    // An installed app can stay open for days without a full load, which is
    // when the browser looks for a new worker by itself.
    const check = () => {
      if (document.visibilityState === "visible") {
        registration?.update().catch(() => undefined);
      }
    };
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        registration = reg;
        // Only an update waits: the first install has no page to disturb.
        const offer = () => {
          if (reg.waiting && navigator.serviceWorker.controller) {
            setWaiting(reg.waiting);
          }
        };
        offer();
        reg.addEventListener("updatefound", () => {
          reg.installing?.addEventListener("statechange", offer);
        });
      })
      .catch((err) => console.warn("service worker:", err));
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, []);

  const reload = () => {
    navigator.serviceWorker.addEventListener("controllerchange", () =>
      window.location.reload()
    );
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a ServiceWorker's postMessage takes no origin
    waiting?.postMessage("skip-waiting");
  };

  return (
    <>
      {offline && (
        <output className="sticky top-0 z-10 block bg-danger px-4 py-1.5 text-center text-sm text-danger-foreground">
          Offline: showing the last saved copy. Changes won&apos;t save until
          you&apos;re back online.
        </output>
      )}
      {waiting && !offline && (
        <output
          aria-live="polite"
          className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-md items-center gap-3 rounded-card border border-border bg-card py-1.5 pr-1.5 pl-4 text-sm shadow-card lg:bottom-6"
        >
          <span className="flex-1">A new version is ready.</span>
          <Button size="sm" onClick={reload}>
            Reload
          </Button>
        </output>
      )}
    </>
  );
};

/**
 * Asks the service worker to keep this week (its page, meal pages and
 * shopping list) for offline use: after the page loads, and whenever the app
 * comes back to the foreground, which is when someone heads to the shop. The
 * worker decides what needs fetching again.
 */
export const PrecacheWeek = ({ week }: { week: string }) => {
  useEffect(() => {
    if (!swEnabled()) {
      return;
    }
    let cancelled = false;
    const start = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) {
        return;
      }
      void navigator.serviceWorker.ready.then((reg) => {
        if (!cancelled) {
          reg.active?.postMessage({ type: "precache", week });
        }
      });
    };
    // After the page's own requests, so it doesn't compete with them.
    if (document.readyState === "complete") {
      start();
    } else {
      window.addEventListener("load", start, { once: true });
    }
    document.addEventListener("visibilitychange", start);
    return () => {
      cancelled = true;
      window.removeEventListener("load", start);
      document.removeEventListener("visibilitychange", start);
    };
  }, [week]);
  return null;
};

/**
 * On sign-out: asks the service worker to drop cached pages and photos and
 * clears queued shop-list changes, so neither the plan nor the list stays on
 * the device.
 */
export const clearDeviceData = () => {
  navigator.serviceWorker?.controller?.postMessage("clear-pages");
  clearAllQueues();
};
