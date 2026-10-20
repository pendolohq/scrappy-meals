import { expect, type Page, test } from "@playwright/test";
import { readFileSync } from "node:fs";

import { formatDay } from "../src/lib/format";
import { addDays, today, weekStartOf } from "../src/server/domain/week";

import { STATE_FILE, USERS } from "./global-setup";

const state = () =>
  JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
    recipe: { name: string; slug: string };
    food: string;
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

test("cooks a planned meal from its recipe page", async ({ page }) => {
  const { recipe, food } = state();
  await signIn(page, USERS.alex);
  const dayLabel = formatDay(otherDay());
  const day = page.locator(`section[aria-label="${dayLabel}"]`);
  const alexKcal = day.getByTestId("totals-Alex").getByTestId("kcal");

  await day.getByRole("button", { name: "Add dinner" }).click();
  await page.getByRole("dialog").getByLabel("Search recipes").fill(recipe.name);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: new RegExp(recipe.name) })
    .click();
  const meal = day.getByTestId("meal").filter({ hasText: recipe.name });
  await expect(alexKcal).toHaveText("400");

  await meal.getByRole("link", { name: recipe.name }).click();
  await expect(page).toHaveURL(/\/meals\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("heading", { level: 1, name: recipe.name })
  ).toBeVisible();
  await expect(page.getByTestId("instructions")).toContainText(
    "Rinse the lentils."
  );
  await expect(page.getByText("Keeps for 3 months.")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Edit in Mealie" })
  ).toHaveAttribute("href", new RegExp(`/g/[^/]+/r/${recipe.slug}$`));

  // Alex and Sam at 1 each: 2 of 4 servings, as the shopping list has it.
  const ingredients = page.getByTestId("ingredients");
  const qty = ingredients.getByTestId("qty");
  await expect(ingredients).toContainText(food);
  await expect(qty).toHaveText("200 g");
  // The step linked to the lentils in Mealie lists them, in the same amount.
  const stepIngredients = page.getByTestId("step-ingredients");
  await expect(stepIngredients).toHaveCount(1);
  await expect(stepIngredients).toHaveText(`200 g ${food}`);

  // Cooking for more rescales the list (and its steps) only.
  await page.getByRole("button", { name: "More (Cooking for)" }).click();
  await expect(page.getByTestId("cooking-for")).toHaveText("3");
  await expect(qty).toHaveText("300 g");
  await expect(stepIngredients).toHaveText(`300 g ${food}`);
  await page.getByRole("button", { name: /Reset to plan/ }).click();
  await expect(qty).toHaveText("200 g");
  await page.getByRole("button", { name: "More (Cooking for)" }).click();
  await expect(qty).toHaveText("300 g");

  await page.getByRole("link", { name: "Back to the plan" }).click();
  await expect(alexKcal).toHaveText("400");

  // A portion changed on the recipe page is saved to the plan.
  await meal.getByRole("link", { name: recipe.name }).click();
  await page
    .getByRole("button", { name: `More (Alex's portion of ${recipe.name})` })
    .click();
  // The list follows the plan again: 2.25 of 4 servings.
  await expect(qty).toHaveText("225 g");
  await page.getByRole("link", { name: "Back to the plan" }).click();
  await expect(alexKcal).toHaveText("500");

  // With everyone at 0, the recipe is shown for one, and never for fewer.
  await meal.getByRole("link", { name: recipe.name }).click();
  for (const name of ["Alex", "Sam"]) {
    const portion = page.getByRole("group", {
      name: `${name}'s portion of ${recipe.name}`,
    });
    const less = portion.getByRole("button", { name: /^Less/ });
    while (await less.isEnabled()) {
      const before = await portion.getByTestId("portion").textContent();
      await less.click();
      await expect(portion.getByTestId("portion")).not.toHaveText(before ?? "");
    }
  }
  await expect(page.getByText("Nobody eats this in the plan")).toBeVisible();
  await expect(page.getByTestId("cooking-for")).toHaveText("1");
  await expect(qty).toHaveText("100 g");
  await expect(
    page.getByRole("button", { name: "Less (Cooking for)" })
  ).toBeDisabled();
  await page.getByRole("link", { name: "Back to the plan" }).click();

  // The smoke test pushes this week's shopping list and expects only its own
  // meal on it.
  await meal
    .getByRole("button", { name: `Options for ${recipe.name}` })
    .click();
  await meal.getByRole("button", { name: "Remove" }).click();
  await expect(meal).toHaveCount(0);
});
