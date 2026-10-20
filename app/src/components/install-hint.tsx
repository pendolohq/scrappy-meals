"use client";

import { useSyncExternalStore } from "react";
import { Share, Smartphone, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import {
  dismissInstallHint,
  promptInstall,
  readDismissed,
  readInstall,
  serverDismissed,
  serverInstall,
  subscribeInstall,
} from "@/lib/install";

const useInstall = () =>
  useSyncExternalStore(subscribeInstall, readInstall, serverInstall);

const IosSteps = () => (
  <>
    tap Share{" "}
    <Share
      className="inline size-4 align-text-bottom"
      aria-label="(the box with an arrow)"
    />{" "}
    then <strong className="font-medium">Add to Home Screen</strong>.
  </>
);

/** Settings: how to install, on whatever this device is. Gone once installed. */
export const InstallCard = () => {
  const state = useInstall();
  if (state === "installed") {
    return null;
  }
  return (
    <Card as="section" aria-labelledby="install-heading">
      <h2
        id="install-heading"
        className="font-serif text-heading font-semibold"
      >
        Install the app
      </h2>
      <p className="mt-1 text-sm text-muted">
        It opens straight to the week, full screen, and this week&apos;s meals
        and shopping list stay readable without a signal.
      </p>
      <p className="mt-3 text-sm">
        {state === "prompt" && (
          <Button onClick={() => void promptInstall()}>
            <Smartphone className="size-4" aria-hidden />
            Install
          </Button>
        )}
        {state === "ios" && (
          <>
            In Safari, <IosSteps />
          </>
        )}
        {state === "other" && (
          <>
            Open your browser&apos;s menu and choose{" "}
            <strong className="font-medium">Install app</strong> or{" "}
            <strong className="font-medium">Add to Home screen</strong>.
          </>
        )}
      </p>
    </Card>
  );
};

/**
 * Phones, once per device: a dismissible nudge where the browser can install
 * (a prompt we can open) or never will by itself (iOS). Settings keeps the
 * same hint after it's dismissed.
 */
export const InstallBanner = () => {
  const state = useInstall();
  const dismissed = useSyncExternalStore(
    subscribeInstall,
    readDismissed,
    serverDismissed
  );
  if (dismissed || (state !== "prompt" && state !== "ios")) {
    return null;
  }
  return (
    <aside
      aria-label="Install the app"
      className="mb-5 flex items-center gap-3 rounded-card border border-border/70 bg-card py-2 pr-1 pl-4 text-sm shadow-card lg:hidden"
    >
      <Smartphone className="size-5 shrink-0 text-accent-ink" aria-hidden />
      <p className="min-w-0 flex-1">
        {state === "prompt" ? (
          "Install the app: it opens on this week and works offline."
        ) : (
          <>
            Install the app: in Safari, <IosSteps />
          </>
        )}
      </p>
      {state === "prompt" && (
        <Button size="sm" variant="ghost" onClick={() => void promptInstall()}>
          Install
        </Button>
      )}
      <IconButton label="Dismiss" onClick={dismissInstallHint}>
        <X className="size-4" aria-hidden />
      </IconButton>
    </aside>
  );
};
