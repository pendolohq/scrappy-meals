"use client";

import { useLayoutEffect } from "react";

import { applyTheme, readTheme, subscribeTheme } from "@/lib/theme";

/**
 * Keeps <html data-theme> in step with the stored choice: after hydration
 * (React's dev remount clears what the inline script set, and the toolbar
 * colour is only set here), when the system switches while following it, and
 * when another tab changes it.
 */
export const ThemeSync = () => {
  useLayoutEffect(() => {
    const apply = () => applyTheme(readTheme());
    apply();
    return subscribeTheme(apply);
  }, []);
  return null;
};
