import { afterEach, describe, expect, it, vi } from "vitest";

import { applyTheme, readTheme, saveTheme, themeScript } from "./theme";

const setup = ({
  stored,
  systemDark = false,
}: {
  stored?: string;
  systemDark?: boolean;
}) => {
  const store = new Map(stored === undefined ? [] : [["theme", stored]]);
  const html = { dataset: {} as Record<string, string> };
  const meta = { setAttribute: vi.fn<(name: string, value: string) => void>() };
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  });
  vi.stubGlobal("matchMedia", () => ({ matches: systemDark }));
  vi.stubGlobal("document", {
    documentElement: html,
    querySelector: () => meta,
  });
  return { html, meta, store };
};

/** What the inline <head> script leaves on <html>. */
const runScript = () => {
  new Function(themeScript)();
  return (document.documentElement as unknown as { dataset: object }).dataset;
};

afterEach(() => vi.unstubAllGlobals());

describe("default theme", () => {
  it("is light when nothing is stored, even on a dark system", () => {
    setup({ systemDark: true });
    expect(readTheme()).toBe("light");
    expect(runScript()).toEqual({});
  });

  it("is light when the stored value is unknown", () => {
    setup({ stored: "purple", systemDark: true });
    expect(readTheme()).toBe("light");
    expect(runScript()).toEqual({});
  });

  it("is light when storage throws", () => {
    setup({ systemDark: true });
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readTheme()).toBe("light");
    expect(runScript()).toEqual({});
  });
});

describe("picked theme", () => {
  it.each([
    ["dark", false, "dark"],
    ["system", true, "dark"],
    ["system", false, "light"],
    ["light", true, "light"],
  ] as const)("%s on a dark=%s system is %s", (stored, systemDark, want) => {
    const { html, meta } = setup({ stored, systemDark });
    expect(runScript()).toEqual(want === "dark" ? { theme: "dark" } : {});
    applyTheme(readTheme());
    expect(html.dataset.theme).toBe(want);
    expect(meta.setAttribute).toHaveBeenCalledWith(
      "content",
      want === "dark" ? "#131a14" : "#f2e8cf"
    );
  });

  it("is stored and applied when saved", () => {
    const { html, store } = setup({});
    saveTheme("dark");
    expect(store.get("theme")).toBe("dark");
    expect(html.dataset.theme).toBe("dark");
    expect(readTheme()).toBe("dark");
  });
});
