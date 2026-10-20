import { expect, type Page, test } from "@playwright/test";
import { readFileSync } from "node:fs";

import { formatDay } from "../src/lib/format";
import { today, weekStartOf } from "../src/server/domain/week";

import { STATE_FILE, USERS } from "./global-setup";

const state = () =>
  JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
    recipe: { name: string };
    food: string;
    extra: string;
  };

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/week\/\d{4}-\d{2}-\d{2}$/);
}

test.describe.configure({ mode: "serial" });

test("is installable", async ({ request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({
    name: "Scrappy Meals",
    display: "standalone",
    start_url: "/week",
  });
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual([
    "192x192",
    "512x512",
    "512x512",
  ]);
  expect((await request.get("/sw.js")).ok()).toBe(true);
  expect(
    (await request.get("/icons/icon-512.png")).headers()["content-type"]
  ).toBe("image/png");
});

test("rejects a wrong password", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(USERS.alex.email);
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("main p[role=alert]")).toHaveText(
    "Invalid email or password."
  );
  // The email stays, so only the password needs typing again.
  await expect(page.getByLabel("Email")).toHaveValue(USERS.alex.email);
});

test("plans, logs and shops a meal, and keeps the week readable offline", async ({
  page,
  context,
}) => {
  const { recipe, food, extra } = state();
  await signIn(page, USERS.alex);
  const day = page.locator(`section[aria-label="${formatDay(today())}"]`);

  // Add today's lunch from Mealie.
  await day.getByRole("button", { name: "Add lunch" }).click();
  await page.getByRole("dialog").getByLabel("Search recipes").fill(recipe.name);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: new RegExp(recipe.name) })
    .click();
  const meal = day.getByTestId("meal").filter({ hasText: recipe.name });
  await expect(meal).toBeVisible();
  await expect(day.getByTestId("totals-Alex").getByTestId("kcal")).toHaveText(
    "400"
  );

  // Sam has a half portion: 1 + 0.5 = 1.5 of 4 servings.
  await meal
    .getByRole("button", { name: `Less (Sam's portion of ${recipe.name})` })
    .click();
  await meal
    .getByRole("button", { name: `Less (Sam's portion of ${recipe.name})` })
    .click();
  await expect(meal.getByTestId("portion").nth(1)).toHaveText("½×");
  await expect(day.getByTestId("totals-Sam").getByTestId("kcal")).toHaveText(
    "200"
  );

  // One tap to log it.
  const stuck = meal.getByRole("button", {
    name: new RegExp(`^Stuck to it: ${recipe.name}`),
  });
  await stuck.click();
  await expect(stuck).toHaveAttribute("aria-pressed", "true");

  // Shopping list: 400 g x 1.5/4 = 150 g, then into Mealie.
  await page.getByRole("link", { name: "Shopping" }).click();
  await expect(page.getByTestId("lines")).toContainText(food);
  await expect(page.getByTestId("qty")).toHaveText("150 g");
  await page.getByRole("button", { name: "Send to Mealie" }).click();
  await expect(page.getByRole("status")).toContainText("Added 1 item");

  // The same page turns into the checklist: tick the item off and add a line of our own.
  await expect(page).toHaveURL(/\/shopping$/);
  await page
    .getByTestId("shop-item")
    .filter({ hasText: food })
    .getByRole("checkbox")
    .click(); // a ticked item moves into "Done"
  await expect(page.getByText("Done (1)")).toBeVisible();
  await page.getByLabel("Add an item").fill(extra);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByTestId("shop-item").filter({ hasText: extra })
  ).toBeVisible();
  await expect(page.getByTestId("pending")).toHaveCount(0); // all saved

  // Offline: once the service worker controls the page, the week stays readable.
  await page.goto("/week");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload(); // now controlled, so this copy is cached
  await expect(
    page.getByTestId("meal").filter({ hasText: recipe.name })
  ).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByText("Offline: showing the last saved copy.")
  ).toBeVisible();
  await expect(
    page.getByTestId("meal").filter({ hasText: recipe.name })
  ).toBeVisible();
  // The installed app opens on "/week", which only redirects and so is never
  // cached itself: offline, it gets this week's cached page.
  await page.goto("/week");
  await expect(
    page.getByTestId("meal").filter({ hasText: recipe.name })
  ).toBeVisible();
  await context.setOffline(false);

  // A session that ended elsewhere (password changed) drops the cached plan
  // as soon as a page bounces to the login screen.
  await context.clearCookies();
  await page.goto("/week");
  await expect(page).toHaveURL(/\/login/);
  await context.setOffline(true);
  await page.goto(`/week/${weekStartOf(today())}`).catch(() => undefined);
  await expect(
    page.getByRole("heading", { name: "You're offline" })
  ).toBeVisible();
  await context.setOffline(false);
  await signIn(page, USERS.alex);

  // Signing out drops the cached plan from this device.
  await page.getByRole("button", { name: /Sign out/ }).click();
  await expect(page).toHaveURL(/\/login/);
  await context.setOffline(true);
  await page.goto("/week").catch(() => undefined);
  await expect(
    page.getByRole("heading", { name: "You're offline" })
  ).toBeVisible();
  await expect(page.getByText(recipe.name)).toHaveCount(0);
  await context.setOffline(false);
});

test("the other person sees the plan and logs only their own meals", async ({
  page,
}) => {
  const { recipe } = state();
  await signIn(page, USERS.sam);
  const meal = page
    .locator(`section[aria-label="${formatDay(today())}"]`)
    .getByTestId("meal")
    .filter({ hasText: recipe.name });
  await expect(meal.getByTestId("adherence-badge")).toHaveText("✓ Stuck to it");
  await expect(meal.getByRole("group", { name: /How did/ })).toHaveCount(1); // Sam's own buttons only

  // One shopping page only: the header has no separate "Shop" link.
  await expect(
    page.getByRole("link", { name: "Shop", exact: true })
  ).toHaveCount(0);
});

test("the other person sees the ticks, and ticks saved offline sync later", async ({
  page,
  context,
}) => {
  const { extra } = state();
  await signIn(page, USERS.sam);
  const week = weekStartOf(today());

  // The old /shop URL may still be cached by an installed app.
  await page.goto(`/week/${week}/shop`);
  await expect(page).toHaveURL(new RegExp(`/week/${week}/shopping$`));
  await expect(page.getByText("Done (1)")).toBeVisible();

  // The plan's preview stays reachable, folded away under the checklist.
  const needs = page.locator("details", { hasText: "What the plan needs" });
  await expect(needs).not.toHaveAttribute("open", "");
  await needs.getByText("What the plan needs").click();
  await expect(needs.getByTestId("lines")).toContainText(state().food);
  await expect(needs.getByTestId("qty")).toHaveText("150 g");
  await needs.getByText("What the plan needs").click();

  const coffee = page.getByTestId("shop-item").filter({ hasText: extra });
  await expect(coffee).toBeVisible();

  // No signal in the shop: the tick shows at once and waits in a queue.
  await context.setOffline(true);
  await coffee.getByRole("checkbox").click();
  await expect(page.getByText("Done (2)")).toBeVisible();
  await expect(page.getByTestId("pending")).toContainText("1 change");
  await context.setOffline(false);
  await expect(page.getByTestId("pending")).toHaveCount(0);

  await page.reload();
  await expect(page.getByText("Done (2)")).toBeVisible();
});
