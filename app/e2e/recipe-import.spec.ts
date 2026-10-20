import { expect, type Page, test } from "@playwright/test";
import { readFileSync } from "node:fs";

import { STATE_FILE, USERS } from "./global-setup";

// A successful import can't run here: Mealie refuses loopback and private
// addresses and CI has no public page. The duplicate check is covered with a
// recipe global setup created from given HTML.
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

const submit = async (page: Page, url: string) => {
  await page.getByLabel("Recipe URL").fill(url);
  await page.getByRole("button", { name: "Import recipe" }).click();
};

test.beforeEach(async ({ page }) => {
  await signIn(page, USERS.alex);
});

test("the header links to the Add recipe page", async ({ page }) => {
  await page.getByRole("link", { name: "Add recipe" }).click();
  await expect(page).toHaveURL(/\/recipes\/new$/);
  await expect(page.getByLabel("Recipe URL")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import recipe" })
  ).toBeVisible();
});

for (const bad of ["not a url", "http://localhost/x", "ftp://example.com/x"]) {
  test(`rejects "${bad}" and stays on the page`, async ({ page }) => {
    await page.goto("/recipes/new");
    await submit(page, bad);
    await expect(page.locator("main p[role=alert]")).toBeVisible();
    await expect(page).toHaveURL(/\/recipes\/new$/);
  });
}

test("says so when Mealie finds no recipe at the address", async ({ page }) => {
  await page.goto("/recipes/new");
  await submit(page, "http://127.0.0.1/recipe");
  await expect(page.locator("main p[role=alert]")).toHaveText(
    "Couldn't find a recipe on that page."
  );
  await expect(page).toHaveURL(/\/recipes\/new$/);
});

test("links to a recipe that was already imported from that page", async ({
  page,
}) => {
  const { imported } = state();
  await page.goto("/recipes/new");
  await submit(page, imported.url);
  const link = page.getByRole("link", {
    name: `Already imported: ${imported.name}`,
  });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute(
    "href",
    `/recipes/${imported.slug}/review`
  );
  await expect(page).toHaveURL(/\/recipes\/new$/);
});
