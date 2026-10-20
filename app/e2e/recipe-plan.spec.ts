import { expect, type Page, test } from "@playwright/test";
import { readFileSync } from "node:fs";

import { formatDay } from "../src/lib/format";
import { addDays, today, weekStartOf } from "../src/server/domain/week";

import { STATE_FILE, USERS } from "./global-setup";
import { planMeal } from "./plan-meal";

const state = () =>
  JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
    reel: { name: string; url: string; slug: string };
  };

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/week\/\d{4}-\d{2}-\d{2}$/);
}

// A day of this week that isn't today, so the smoke test's totals for today
// stay as they expect.
const otherDay = () => {
  const start = weekStartOf(today());
  return today() === start ? addDays(start, 1) : start;
};

test("an imported recipe is flagged in the plan until it is reviewed", async ({
  page,
}) => {
  const { reel } = state();
  await signIn(page, USERS.alex);
  const day = page.locator(`section[aria-label="${formatDay(otherDay())}"]`);

  await planMeal(page, { date: otherDay(), slot: "Dinner", recipe: reel.name });
  const meal = day.getByTestId("meal").filter({ hasText: reel.name });
  await expect(meal.getByText("≈ Estimated nutrition")).toBeVisible();
  await expect(
    day.getByTestId("totals-Alex").getByText("≈ estimated")
  ).toBeVisible();

  await meal.getByRole("link", { name: "Needs review" }).click();
  await expect(page).toHaveURL(`/recipes/${reel.slug}/review`);
  await expect(page.getByRole("link", { name: "Source" })).toHaveAttribute(
    "href",
    reel.url
  );
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");

  await page.getByRole("link", { name: "Back to the plan" }).click();
  const after = page
    .locator(`section[aria-label="${formatDay(otherDay())}"]`)
    .getByTestId("meal")
    .filter({ hasText: reel.name });
  await expect(after).toBeVisible();
  await expect(after.getByRole("link", { name: "Needs review" })).toHaveCount(
    0
  );
  await expect(after.getByText("≈ Estimated nutrition")).toHaveCount(0);
  // The meal name leads to the meal's recipe page.
  await expect(after.getByRole("link", { name: reel.name })).toHaveAttribute(
    "href",
    new RegExp(`^/week/${weekStartOf(today())}/meals/[0-9a-f-]{36}$`)
  );

  // The smoke test pushes this week's shopping list and expects only its own
  // meal on it.
  await after.getByRole("button", { name: `Options for ${reel.name}` }).click();
  await after.getByRole("button", { name: "Remove" }).click();
  await expect(after).toHaveCount(0);
});
