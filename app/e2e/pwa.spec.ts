import {
  type BrowserContext,
  devices,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { readFileSync } from "node:fs";

import { formatDay } from "../src/lib/format";
import { addDays, today, weekStartOf } from "../src/server/domain/week";

import { STATE_FILE, USERS } from "./global-setup";
import { planMeal } from "./plan-meal";

const state = () =>
  JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
    recipe: { name: string };
    food: string;
  };

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/week\/\d{4}-\d{2}-\d{2}$/);
}

// Playwright cuts the service worker off only when offline is set: a worker
// started since then would still reach the network. So set it per navigation.
async function gotoOffline(page: Page, context: BrowserContext, url: string) {
  await context.setOffline(false);
  await context.setOffline(true);
  await page.goto(url).catch(() => undefined);
}

// A day of this week that isn't today, so the smoke test's totals for today
// stay as they expect.
const otherDay = () => {
  const start = weekStartOf(today());
  return today() === start ? addDays(start, 1) : start;
};

test("the manifest offers the richer install dialog and shortcuts", async ({
  request,
}) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  // Installs from before the id existed used start_url as theirs.
  expect(manifest.id).toBe("/week");
  expect(
    manifest.screenshots.map((s: { form_factor: string }) => s.form_factor)
  ).toEqual(["narrow", "wide"]);
  // The install dialog fetches these before anyone has signed in.
  for (const { src, sizes } of manifest.screenshots) {
    const res = await request.get(src, { maxRedirects: 0 });
    expect(res.headers()["content-type"]).toBe("image/png");
    const png = await res.body();
    // Width and height sit at bytes 16 and 20 of a PNG's header.
    expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(sizes);
  }
  expect(manifest.shortcuts.map((s: { url: string }) => s.url)).toEqual([
    "/week",
    "/shopping",
    "/recipes/new",
  ]);
});

test("the shopping shortcut opens this week's list", async ({ page }) => {
  await signIn(page, USERS.alex);
  await page.goto("/shopping");
  await expect(page).toHaveURL(`/week/${weekStartOf(today())}/shopping`);
});

test.describe("on an iPhone", () => {
  test.use({ userAgent: devices["iPhone 15"].userAgent });

  test("explains Add to Home Screen, once as a banner and always in Settings", async ({
    page,
  }) => {
    await signIn(page, USERS.alex);
    const banner = page.getByRole("complementary", { name: "Install the app" });
    await expect(banner).toContainText("Add to Home Screen");
    await banner.getByRole("button", { name: "Dismiss" }).click();
    await expect(banner).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("main")).toBeVisible();
    await expect(banner).toHaveCount(0);

    await page.goto("/settings");
    await expect(
      page.getByRole("region", { name: "Install the app" })
    ).toContainText("Add to Home Screen");
  });

  test("says nothing about installing once it runs installed", async ({
    page,
  }) => {
    // Chromium can't be launched as an installed app; this is what the hint asks.
    await page.addInitScript(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (query: string) =>
        query === "(display-mode: standalone)"
          ? ({ ...real(query), matches: true } as MediaQueryList)
          : real(query);
    });
    await signIn(page, USERS.sam);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText("Install the app")).toHaveCount(0);
    await page.goto("/settings");
    await expect(page.getByRole("group", { name: "Theme" })).toBeVisible();
    await expect(page.getByText("Install the app")).toHaveCount(0);
  });
});

test("keeps this week's meals and shopping list readable offline, until sign-out", async ({
  page,
  context,
}) => {
  const { recipe, food } = state();
  await signIn(page, USERS.alex);
  const week = weekStartOf(today());
  await planMeal(page, {
    date: otherDay(),
    slot: "Breakfast",
    recipe: recipe.name,
  });
  const day = page.locator(`section[aria-label="${formatDay(otherDay())}"]`);
  const meal = day.getByTestId("meal").filter({ hasText: recipe.name });
  const mealUrl = await meal
    .getByRole("link", { name: recipe.name })
    .getAttribute("href");
  expect(mealUrl).toMatch(new RegExp(`^/week/${week}/meals/`));

  // The worker fetches the week in the background after each load; the meal
  // page itself is never opened here.
  await page.reload();
  await expect
    .poll(
      () =>
        page.evaluate(async (url) => {
          const keys = await caches.keys();
          const pages = keys.find((k) => k.startsWith("pages-"));
          return Boolean(
            pages &&
            (await (await caches.open(pages)).match(url, { ignoreVary: true }))
          );
        }, mealUrl!),
      { timeout: 20_000 }
    )
    .toBe(true);

  await gotoOffline(page, context, mealUrl!);
  await expect(
    page.getByRole("heading", { level: 1, name: recipe.name })
  ).toBeVisible();
  await expect(page.getByTestId("instructions")).toContainText(
    "Rinse the lentils."
  );
  await gotoOffline(page, context, `/week/${week}/shopping`);
  await expect(page.getByText(food).first()).toBeVisible();
  // The shortcut only redirects; offline it opens this week's cached list.
  await gotoOffline(page, context, "/shopping");
  await expect(page.getByText(food).first()).toBeVisible();
  await context.setOffline(false);

  // Signing out drops the meal pages and the list too.
  await page.goto(`/week/${week}`);
  await page.getByRole("button", { name: /Sign out/ }).click();
  await expect(page).toHaveURL(/\/login/);
  for (const url of [mealUrl!, `/week/${week}/shopping`]) {
    await gotoOffline(page, context, url);
    await expect(
      page.getByRole("heading", { name: "You're offline" })
    ).toBeVisible();
  }
  await context.setOffline(false);

  // The smoke test pushes this week's shopping list and expects only its own
  // meal on it.
  await signIn(page, USERS.alex);
  await page.goto(`/week/${week}`);
  await meal
    .getByRole("button", { name: `Options for ${recipe.name}` })
    .click();
  await meal.getByRole("button", { name: "Remove" }).click();
  await expect(meal).toHaveCount(0);
});
