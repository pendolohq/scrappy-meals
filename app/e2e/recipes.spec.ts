import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

import { STATE_FILE, USERS } from "./global-setup";

// A fresh import can't run here: Mealie refuses loopback and private
// addresses and CI has no public page. So this starts from a recipe global
// setup imported from given HTML, and goes through the duplicate check.
const state = () =>
  JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
    imported: { name: string; slug: string; url: string };
  };

test("imports a recipe, then reviews and saves it", async ({ page }) => {
  const { imported } = state();
  await page.goto("/login");
  await page.getByLabel("Email").fill(USERS.alex.email);
  await page.getByLabel("Password").fill(USERS.alex.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/week\/\d{4}-\d{2}-\d{2}$/);

  await page.getByRole("link", { name: "Add recipe" }).click();
  await expect(page).toHaveURL(/\/recipes\/new$/);
  await page.getByLabel("Recipe URL").fill(imported.url);
  await page.getByRole("button", { name: "Import recipe" }).click();
  await page
    .getByRole("link", { name: `Already imported: ${imported.name}` })
    .click();
  await expect(page).toHaveURL(`/recipes/${imported.slug}/review`);

  await expect(page.getByLabel("Servings")).toHaveValue("4");
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("350");
  const lemon = page.getByRole("group", {
    name: "a squeeze of lemon",
    exact: true,
  });
  await expect(lemon.getByText("Check this line")).toBeVisible();

  await lemon.getByLabel("Keep as text").check();
  await page.getByLabel("Protein (g)").fill("30");
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");

  // Saved to Mealie, not just shown as saved.
  await page.reload();
  await expect(page.getByLabel("Protein (g)")).toHaveValue("30");
  await expect(page.getByText("Reviewed")).toBeVisible();
  await expect(lemon.getByText("Check this line")).toHaveCount(0);
});
