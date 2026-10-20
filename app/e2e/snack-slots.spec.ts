import { expect, type Page, test } from "@playwright/test";
import { readFileSync } from "node:fs";

import { formatDay } from "../src/lib/format";
import { addDays, today, weekStartOf } from "../src/server/domain/week";

import { STATE_FILE, USERS } from "./global-setup";

const state = () =>
  JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
    recipe: { name: string; slug: string };
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

test("plans the same recipe in two snack slots of one day", async ({
  page,
}) => {
  const { recipe } = state();
  await signIn(page, USERS.alex);
  const day = page.locator(`section[aria-label="${formatDay(otherDay())}"]`);
  const alexKcal = day.getByTestId("totals-Alex").getByTestId("kcal");
  const slotOf = (label: string) => day.getByRole("group", { name: label });

  const add = async (slotLabel: string) => {
    await day
      .getByRole("button", { name: `Add ${slotLabel.toLowerCase()}` })
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("Search recipes")
      .fill(recipe.name);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: new RegExp(recipe.name) })
      .click();
  };

  await add("Morning snack");
  const morning = slotOf("Morning snack")
    .getByTestId("meal")
    .filter({ hasText: recipe.name });
  await expect(morning).toHaveCount(1);
  await expect(alexKcal).not.toHaveText("0");
  const one = Number(await alexKcal.textContent());
  expect(one).toBeGreaterThan(0);

  await add("Afternoon snack");
  const afternoon = slotOf("Afternoon snack")
    .getByTestId("meal")
    .filter({ hasText: recipe.name });
  await expect(afternoon).toHaveCount(1);

  // Each meal sits under its own snack section, not both under one.
  await expect(morning).toHaveCount(1);
  await expect(alexKcal).toHaveText(String(one * 2));

  // The smoke test pushes this week's shopping list and expects only its own
  // meal on it.
  for (const meal of [morning, afternoon]) {
    await meal
      .getByRole("button", { name: `Options for ${recipe.name}` })
      .click();
    await meal.getByRole("button", { name: "Remove" }).click();
    await expect(meal).toHaveCount(0);
  }
});
