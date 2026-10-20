"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

import { Card } from "@/components/ui/card";
import {
  readTheme,
  saveTheme,
  serverTheme,
  subscribeTheme,
  type Theme,
} from "@/lib/theme";

const OPTIONS: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

// Not part of the settings form: it's stored on this device, not on the
// server, and applies as soon as it's picked.
export const ThemePicker = () => {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, serverTheme);

  return (
    <Card as="fieldset">
      <legend className="sr-only">Theme</legend>
      <h2 aria-hidden className="font-serif text-heading font-semibold">
        Theme
      </h2>
      <p className="mt-1 mb-4 text-sm text-muted">
        On this device only. System follows its light or dark setting.
      </p>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map(({ value, label, Icon }) => (
          <label
            key={value}
            className="relative flex min-h-tap cursor-pointer items-center gap-1.5 rounded-button border border-border-strong bg-card px-4 text-sm font-medium transition hover:bg-sunken has-checked:border-accent has-checked:bg-accent has-checked:text-accent-foreground has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent"
          >
            <input
              type="radio"
              name="theme"
              value={value}
              checked={theme === value}
              onChange={() => saveTheme(value)}
              className="sr-only"
            />
            <Icon className="size-4" aria-hidden />
            {label}
          </label>
        ))}
      </div>
    </Card>
  );
};
