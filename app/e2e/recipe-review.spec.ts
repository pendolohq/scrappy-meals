import { expect, type Page, test } from "@playwright/test";
import { readFileSync } from "node:fs";

import { STATE_FILE, USERS } from "./global-setup";

// All tests share the "imported" recipe from global setup (it has no
// scrappyReview key). Tests run in file order with one worker, and the last
// test saves it, so keep the read-only and failing-save tests above it.
const state = () =>
  JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
    imported: { name: string; slug: string; url: string };
  };

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/week\/\d{4}-\d{2}-\d{2}$/);
}

const line = (page: Page, original: string) =>
  page.getByRole("group", { name: original, exact: true });

test.beforeEach(async ({ page }) => {
  await signIn(page, USERS.alex);
});

test("shows the recipe, its source, nutrition and ingredient lines", async ({
  page,
}) => {
  const { imported } = state();
  await page.goto(`/recipes/${imported.slug}/review`);

  await expect(
    page.getByRole("heading", { name: imported.name })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Source" })).toHaveAttribute(
    "href",
    imported.url
  );
  await expect(page.getByLabel("Servings")).toHaveValue("4");
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("350");
  await expect(page.getByLabel("Protein (g)")).toHaveValue("");

  const lentils = line(page, "200 g red lentils");
  await expect(lentils).toBeVisible();
  await expect(lentils.getByLabel("Amount")).toHaveValue("200");
  await expect(lentils.getByLabel("Food")).toHaveValue("red lentils");
  await expect(line(page, "1 onion, chopped")).toBeVisible();

  const lemon = line(page, "a squeeze of lemon");
  await expect(lemon).toBeVisible();
  await expect(lemon.getByText("Check this line")).toBeVisible();
});

test("an unknown slug is a 404", async ({ page }) => {
  const res = await page.goto("/recipes/no-such-recipe-e2e/review");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("button", { name: "Save recipe" })).toHaveCount(
    0
  );
});

for (const bad of ["", "0"]) {
  test(`rejects servings "${bad}" and saves nothing`, async ({ page }) => {
    const { imported } = state();
    await page.goto(`/recipes/${imported.slug}/review`);
    await page.getByLabel("Protein (g)").fill("99");
    await page.getByLabel("Servings").fill(bad);
    await page.getByRole("button", { name: "Save recipe" }).click();

    await expect(page.locator("main p[role=alert]")).toBeVisible();
    await expect(page.getByRole("status")).not.toHaveText("Saved");

    await page.reload();
    await expect(page.getByLabel("Servings")).toHaveValue("4");
    await expect(page.getByLabel("Protein (g)")).toHaveValue("");
    await expect(page.getByText("Reviewed")).toHaveCount(0);
  });
}

// Changes the shared recipe: keep this last.
test("saves edits and shows them as saved after a reload", async ({ page }) => {
  const { imported } = state();
  await page.goto(`/recipes/${imported.slug}/review`);

  await line(page, "a squeeze of lemon").getByLabel("Keep as text").check();
  await page.getByLabel("Protein (g)").fill("30");
  await page.getByRole("button", { name: "Save recipe" }).click();

  await expect(page.getByRole("status")).toHaveText("Saved");
  await expect(
    page.getByRole("link", { name: "Back to the plan" })
  ).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Protein (g)")).toHaveValue("30");
  await expect(page.getByLabel("Servings")).toHaveValue("4");
  await expect(page.getByText("Reviewed")).toBeVisible();
  const lentils = line(page, "200 g red lentils");
  await expect(lentils.getByLabel("Food")).toHaveValue("red lentils");
  await expect(lentils.getByText("Check this line")).toHaveCount(0);
});
