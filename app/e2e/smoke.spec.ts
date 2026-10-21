import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { readFileSync } from "node:fs";

import { formatDay } from "../src/lib/format";
import { createDb } from "../src/server/db/client";
import { addDays, today, weekStartOf } from "../src/server/domain/week";
import { setPassword } from "../src/server/users";

import { STATE_FILE, USERS } from "./global-setup";

// The critical journeys, in order: each test picks up where the last left
// off (Alex plans and ticks, Sam sees it), so they run serially.
const state = () =>
  JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
    recipe: { name: string };
    food: string;
    extra: string;
  };

/** Signs out every device of `user`; the password stays the same. */
async function endSessions(user: { email: string; password: string }) {
  const { db, pool } = createDb(process.env.DATABASE_URL ?? "", { max: 1 });
  try {
    await setPassword(db, user.email, user.password);
  } finally {
    await pool.end();
  }
}

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

test.describe.configure({ mode: "serial" });

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
  const week = weekStartOf(today());
  await signIn(page, USERS.alex);

  // Plan today's lunch from Mealie, on the Plan page.
  await page.goto(`/plan/${week}`);
  const planDay = page.locator(`section[aria-label="${formatDay(today())}"]`);
  await planDay.getByRole("button", { name: "Add lunch" }).click();
  const picker = page.getByRole("dialog");
  await picker.getByLabel("Search recipes").fill(recipe.name);
  await picker.getByRole("button", { name: new RegExp(recipe.name) }).click();
  await expect(
    planDay
      .getByRole("group", { name: "Lunch" })
      .getByTestId("meal")
      .filter({ hasText: recipe.name })
  ).toBeVisible();

  // Next week repeats this one: copy it in, see it on the Week page, then
  // move the copy to another day from its options.
  const nextWeek = addDays(week, 7);
  const copyDay = addDays(today(), 7);
  const moveDay = addDays(nextWeek, copyDay === nextWeek ? 1 : 0);
  await page.goto(`/plan/${nextWeek}`);
  await page.getByRole("button", { name: "Copy last week" }).click();
  await expect(page.getByText("Copied 1 meal.")).toBeVisible();
  await page.goto(`/week/${nextWeek}#${copyDay}`);
  await expect(
    page
      .locator(`section[aria-label="${formatDay(copyDay)}"]`)
      .getByTestId("meal")
      .filter({ hasText: recipe.name })
  ).toBeVisible();
  await page.goto(`/plan/${nextWeek}`);
  const copy = page
    .locator(`section[aria-label="${formatDay(copyDay)}"]`)
    .getByTestId("meal")
    .filter({ hasText: recipe.name });
  await copy
    .getByRole("button", { name: `Options for ${recipe.name}` })
    .click();
  await copy.getByRole("button", { name: "Move", exact: true }).click();
  await copy.getByLabel("Day").selectOption({ label: formatDay(moveDay) });
  await copy.getByRole("button", { name: "Move here" }).click();
  await expect(
    page
      .locator(`section[aria-label="${formatDay(moveDay)}"]`)
      .getByRole("group", { name: "Lunch" })
      .getByTestId("meal")
      .filter({ hasText: recipe.name })
  ).toBeVisible();
  await expect(copy).toHaveCount(0);

  // The hash opens the phone's day carousel on today.
  await page.goto(`/week/${week}#${today()}`);
  const day = page.locator(`section[aria-label="${formatDay(today())}"]`);
  const meal = day.getByTestId("meal").filter({ hasText: recipe.name });
  await expect(meal).toBeVisible();
  await expect(day.getByTestId("totals-Alex").getByTestId("kcal")).toHaveText(
    "400"
  );

  // Sam has a half portion: 1 + 0.5 = 1.5 of 4 servings. Portions are
  // changed from the meal's options.
  await meal
    .getByRole("button", { name: `Options for ${recipe.name}` })
    .click();
  await meal
    .getByRole("button", { name: `Less (Sam's portion of ${recipe.name})` })
    .click();
  await meal
    .getByRole("button", { name: `Less (Sam's portion of ${recipe.name})` })
    .click();
  await expect(meal.getByTestId("portion").nth(1)).toHaveText("½×");
  // The week shows Alex's own numbers; Sam's portion is one short line.
  await expect(meal.getByTestId("portions")).toHaveText("You 1× · Sam ½×");
  await expect(day.getByTestId("totals-Sam")).toHaveCount(0);

  // The meal's page has the recipe, in the amounts the plan needs.
  const mealLink = meal.getByRole("link", { name: recipe.name });
  const mealUrl = (await mealLink.getAttribute("href"))!;
  await mealLink.click();
  await expect(page).toHaveURL(/\/meals\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("instructions")).toContainText(
    "Rinse the lentils."
  );
  await expect(page.getByTestId("ingredients").getByTestId("qty")).toHaveText(
    "150 g"
  );
  await page.getByRole("link", { name: "Back to the plan" }).click();
  await expect(page).toHaveURL(`/week/${week}#${today()}`);
  await expect(day).toBeInViewport();

  // One tap to log it.
  const stuck = meal.getByRole("button", {
    name: new RegExp(`^Stuck to it: ${recipe.name}`),
  });
  await stuck.click();
  await expect(stuck).toHaveAttribute("aria-pressed", "true");

  // Shopping list: 400 g x 1.5/4 = 150 g, tickable straight away.
  await page.getByRole("link", { name: "Shopping" }).click();
  await expect(page).toHaveURL(/\/shopping$/);
  await expect(
    page.getByTestId("shop-item").filter({ hasText: food })
  ).toContainText("150 g");
  await expect(page.getByTestId("qty")).toHaveText("150 g");

  // Tick the item off and add a line of our own.
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
  await page.goto(`/week/${week}`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload(); // now controlled, so this copy is cached
  await expect(
    page.getByTestId("meal").filter({ hasText: recipe.name })
  ).toBeVisible();
  // The worker also fetches the week's meal pages in the background.
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
        }, mealUrl),
      { timeout: 20_000 }
    )
    .toBe(true);

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
  await gotoOffline(page, context, mealUrl);
  await expect(page.getByTestId("instructions")).toContainText(
    "Rinse the lentils."
  );
  // The list too; the item still to buy, as the lentils are folded under "Done".
  const toBuy = page.getByTestId("shop-item").filter({ hasText: extra });
  await gotoOffline(page, context, `/week/${week}/shopping`);
  await expect(toBuy).toBeVisible();
  // So does the shopping shortcut, which also only redirects.
  await gotoOffline(page, context, "/shopping");
  await expect(toBuy).toBeVisible();
  await context.setOffline(false);

  // A session that ended elsewhere (password changed) drops the cached plan
  // as soon as a page bounces to the login screen. Ended on the server, as
  // `scrappy user passwd` does: clearing the cookies instead races the
  // page's prefetches, whose responses bring the session cookie back.
  await endSessions(USERS.alex);
  await page.goto("/week");
  await expect(page).toHaveURL(/\/login/);
  await gotoOffline(page, context, `/week/${week}`);
  await expect(
    page.getByRole("heading", { name: "You're offline" })
  ).toBeVisible();
  await context.setOffline(false);
  await signIn(page, USERS.alex);

  // Signing out drops the cached week, meal pages and list from this device.
  await page.getByRole("button", { name: /Sign out/ }).click();
  await expect(page).toHaveURL(/\/login/);
  for (const url of ["/week", mealUrl, `/week/${week}/shopping`]) {
    await gotoOffline(page, context, url);
    await expect(
      page.getByRole("heading", { name: "You're offline" })
    ).toBeVisible();
    await expect(page.getByText(recipe.name)).toHaveCount(0);
  }
  await context.setOffline(false);
});

test("the other person sees the plan, logs only their own meals, and ticks offline", async ({
  page,
  context,
}) => {
  const { recipe, extra } = state();
  await signIn(page, USERS.sam);
  const day = page.locator(`section[aria-label="${formatDay(today())}"]`);
  const meal = day.getByTestId("meal").filter({ hasText: recipe.name });
  await expect(meal.getByTestId("adherence-mark")).toHaveText(/Stuck to it/);
  await expect(meal.getByRole("group", { name: /How did/ })).toHaveCount(1); // Sam's own buttons only

  // Sam's own totals and portion; Alex's only as their portion in the line.
  await expect(day.getByTestId("totals-Sam").getByTestId("kcal")).toHaveText(
    "200"
  );
  await expect(day.getByTestId("totals-Alex")).toHaveCount(0);
  await expect(meal.getByTestId("portions")).toHaveText(/^You ½× · Alex 1×/);

  // Alex's tick is there too.
  await page.goto(`/week/${weekStartOf(today())}/shopping`);
  await expect(page.getByText("Done (1)")).toBeVisible();
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
