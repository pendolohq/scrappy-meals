// Guards the rule from session.ts and action.ts for everything under src/app:
// no server action, route handler or data-reading page may answer someone who
// isn't signed in. New files are picked up automatically.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const touched = vi.hoisted(() => vi.fn<(what: string) => void>());
vi.mock("@/auth", () => ({ auth: async () => null, signIn: vi.fn<() => void>(), signOut: vi.fn<() => void>() }));
vi.mock("@/server/db/client", () => ({
  getDb: () => {
    touched("database");
    throw new Error("database used without a session");
  },
}));
vi.mock("@/server/mealie/client", async (original) => ({
  ...(await original<object>()),
  mealie: () => {
    touched("mealie");
    throw new Error("Mealie used without a session");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn<() => void>() }));

import { SIGNED_OUT } from "./action";

const APP = path.resolve(__dirname, "../app");
const rel = (file: string) => path.relative(APP, file);

/** Reachable without signing in, on purpose. */
const PUBLIC_ACTIONS = ["login/actions.ts"];
const PUBLIC_ROUTES = ["api/auth/[...nextauth]/route.ts", "api/health/route.ts"];

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.join(e.parentPath, e.name));
}

const files = filesUnder(APP);
const actionFiles = files.filter((f) => /\.tsx?$/.test(f) && /^["']use server["']/.test(readFileSync(f, "utf8")));
const routeFiles = files.filter((f) => path.basename(f) === "route.ts");
const pageFiles = files.filter((f) => /\/(page|layout)\.tsx$/.test(f) && rel(f).startsWith("(app)/"));

beforeEach(() => touched.mockClear());

describe("server actions", () => {
  it("finds the action files", () => {
    expect(actionFiles.length).toBeGreaterThan(2);
  });

  for (const file of actionFiles.filter((f) => !PUBLIC_ACTIONS.includes(rel(f)))) {
    it(`${rel(file)}: every action rejects a caller without a session`, async () => {
      const mod: Record<string, unknown> = await import(file);
      const actions = Object.entries(mod).filter(([, v]) => typeof v === "function");
      expect(actions.length).toBeGreaterThan(0);
      for (const [name, fn] of actions) {
        // Called both ways: (input) for plain actions, (prevState, formData) for forms.
        for (const args of [[{}], [{}, new FormData()]]) {
          const result = await (fn as (...a: unknown[]) => Promise<unknown>)(...args);
          expect({ name, result }).toEqual({ name, result: { error: SIGNED_OUT } });
        }
      }
      expect(touched).not.toHaveBeenCalled();
    });
  }
});

describe("route handlers", () => {
  for (const file of routeFiles.filter((f) => !PUBLIC_ROUTES.includes(rel(f)))) {
    it(`${rel(file)}: answers 401 without a session`, async () => {
      const mod: Record<string, unknown> = await import(file);
      const handlers = ["GET", "POST", "PUT", "PATCH", "DELETE"].filter((m) => typeof mod[m] === "function");
      expect(handlers.length).toBeGreaterThan(0);
      for (const method of handlers) {
        const req = new NextRequest("http://localhost/x?q=soup", { method });
        const ctx = { params: Promise.resolve({ id: "7b0c1c9e-4c1a-4f55-9a0e-2f4d8d6f2a10" }) };
        const res = await (mod[method] as (r: Request, c: unknown) => Promise<Response>)(req, ctx);
        expect({ method, status: res.status }).toEqual({ method, status: 401 });
      }
      expect(touched).not.toHaveBeenCalled();
    });
  }
});

describe("pages", () => {
  // A layout doesn't always re-render on navigation, so each page that reads
  // data must check the session itself.
  const readsData = (src: string) => /getDb\(|^import \{[^}]*\} from "@\/server\/(?!domain\/|session")/m.test(src);

  for (const file of pageFiles) {
    const src = readFileSync(file, "utf8");
    if (!readsData(src)) {
      continue;
    }
    it(`${rel(file)} calls requireUser()`, () => {
      expect(src).toMatch(/\brequireUser\(\)/);
    });
  }
});
