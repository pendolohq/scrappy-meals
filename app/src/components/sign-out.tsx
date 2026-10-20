"use client";

import { LogOut } from "lucide-react";

import { signOutAction } from "@/app/(app)/actions";
import { cx } from "@/lib/cx";

import { clearDeviceData } from "./pwa";
import { iconButtonClass } from "./ui/icon-button";

/** `compact` is an icon button (the phone's top bar); otherwise a row with the name. */
export const SignOut = ({
  name,
  compact = false,
}: {
  name: string;
  compact?: boolean;
}) => {
  return (
    <form
      action={async () => {
        await signOutAction({});
      }}
      onSubmit={clearDeviceData}
    >
      {compact ? (
        <button
          type="submit"
          aria-label={`Sign out ${name}`}
          title={`Sign out ${name}`}
          className={iconButtonClass()}
        >
          <LogOut className="size-5" aria-hidden />
        </button>
      ) : (
        <button
          type="submit"
          className={cx(
            "flex min-h-tap w-full items-center gap-3 rounded-control px-3 text-left text-sm text-muted transition hover:bg-sunken hover:text-foreground"
          )}
        >
          <span
            aria-hidden
            className="flex size-7 items-center justify-center rounded-full bg-highlight-soft text-xs font-semibold text-highlight"
          >
            {name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate">Sign out {name}</span>
          <LogOut className="size-4" aria-hidden />
        </button>
      )}
    </form>
  );
};
