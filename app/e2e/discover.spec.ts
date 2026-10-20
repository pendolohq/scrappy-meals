import { expect, type Page, test } from "@playwright/test";
import { readFileSync } from "node:fs";

import { formatDay } from "../src/lib/format";
import { addDays, today, weekStartOf } from "../src/server/domain/week";

import { STATE_FILE, USERS } from "./global-setup";

const state = () =>
  JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
    discover: {
      name: string;
      slug: string;
      slowName: string;
      tag: { name: string; slug: string };
    };
  };

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/week\/\d{4}-\d{2}-\d{2}$/);
}

test.beforeEach(async ({ page }) => {
  await signIn(page, USERS.alex);
});

test("filters recipes by tag, category and quick", async ({ page }) => {
  const { discover } = state();
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Recipes" })
    .first()
    .click();
  await expect(page).toHaveURL(/\/recipes$/);

  const filters = page.getByTestId("discover-filters");
  const results = page.getByTestId("discover-results");
  const shown = () => results.getByRole("link");
  await filters.getByRole("link", { name: discover.tag.name }).click();
  await expect(page).toHaveURL(new RegExp(`tag=${discover.tag.slug}`));
  await expect(shown()).toHaveCount(2);

  await filters.getByRole("link", { name: "Vegan" }).click();
  await expect(shown()).toHaveCount(1);
  await expect(
    results.getByRole("link", { name: discover.name })
  ).toBeVisible();

  // Vegetarian takes in vegan recipes too.
  await filters.getByRole("link", { name: "Vegan" }).click();
  await filters.getByRole("link", { name: "Vegetarian" }).click();
  await expect(shown()).toHaveCount(2);

  // Quick is 30 minutes or less: the 45-minute pancakes drop out.
  await filters.getByRole("link", { name: /Quick/ }).click();
  await expect(page).toHaveURL(/quick=1/);
  await expect(shown()).toHaveCount(1);
  await expect(
    results.getByRole("link", { name: discover.slowName })
  ).toHaveCount(0);

  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/recipes$/);
});

test("adds a recipe to the plan from its page", async ({ page }) => {
  const { discover } = state();
  await page.goto(`/recipes?tag=${discover.tag.slug}`);
  await page.getByRole("link", { name: discover.name }).click();
  await expect(page).toHaveURL(`/recipes/${discover.slug}`);
  await expect(
    page.getByRole("heading", { level: 1, name: discover.name })
  ).toBeVisible();
  await expect(page.getByLabel("About this recipe")).toContainText("10 min");
  await expect(page.getByTestId("ingredients")).toContainText("80 g oats");

  await page.getByRole("button", { name: "Add to meal plan" }).click();
  const dialog = page.getByRole("dialog");
  // The recipe is tagged Breakfast, so that slot starts picked.
  await expect(
    dialog.getByRole("button", { name: "Breakfast", exact: true })
  ).toHaveAttribute("aria-pressed", "true");

  // Next week, so the other specs' totals for this week stay as they are.
  const day = addDays(today(), 7);
  await dialog.getByRole("button", { name: "Next week" }).click();
  await dialog
    .getByRole("button", { name: formatDay(day), exact: true })
    .click();
  await dialog
    .getByRole("button", { name: `Add to breakfast, ${formatDay(day)}` })
    .click();
  await expect(
    dialog.getByText(`Added to breakfast on ${formatDay(day)}.`)
  ).toBeVisible();

  await dialog.getByRole("link", { name: "Open the week" }).click();
  await expect(page).toHaveURL(`/week/${weekStartOf(day)}#${day}`);
  await expect(
    page
      .locator(`section[aria-label="${formatDay(day)}"]`)
      .getByText(discover.name)
  ).toBeVisible();
});
