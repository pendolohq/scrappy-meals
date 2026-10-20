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
  // Passes the form's checks (IP literals don't); .invalid never resolves, so
  // Mealie answers 400 without leaving the machine.
  await submit(page, "https://no-recipe.invalid/recipe");
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

// The Mealie used here has no AI provider, so the social-post path can only
// be exercised up to the point where the planner asks Mealie for its settings.
test("asks for a caption and screenshots only for a social post URL", async ({
  page,
}) => {
  await page.goto("/recipes/new");
  const caption = page.getByLabel("Caption", { exact: true });
  const screenshots = page.getByLabel("Screenshots", { exact: true });
  await expect(caption).toHaveCount(0);
  await expect(screenshots).toHaveCount(0);

  await page
    .getByLabel("Recipe URL")
    .fill("https://www.instagram.com/reel/e2e-caption/");
  await expect(caption).toBeVisible();
  await expect(screenshots).toBeVisible();

  await page.getByLabel("Recipe URL").fill("https://example.com/some/recipe");
  await expect(caption).toHaveCount(0);
  await expect(screenshots).toHaveCount(0);
});

test("asks for the caption or a screenshot when a post has neither", async ({
  page,
}) => {
  const url = "https://www.facebook.com/e2e/posts/no-caption";
  await page.goto("/recipes/new");
  await submit(page, url);
  await expect(page.locator("main p[role=alert]")).toHaveText(
    "Paste the post's caption or add a screenshot: Instagram and Facebook don't let Mealie read posts."
  );
  await expect(page).toHaveURL(/\/recipes\/new$/);
  await expect(page.getByLabel("Recipe URL")).toHaveValue(url);
});

test("says so when Mealie has no AI provider, and keeps the caption", async ({
  page,
}) => {
  const url = "https://www.facebook.com/e2e/posts/with-caption";
  const text = "Lentil soup: 200 g red lentils, 1 onion. Boil for 20 minutes.";
  await page.goto("/recipes/new");
  await page.getByLabel("Recipe URL").fill(url);
  await page.getByLabel("Caption", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Import recipe" }).click();
  await expect(page.locator("main p[role=alert]")).toHaveText(
    "Mealie has no AI provider set up. Add one in Mealie's group settings, then try again."
  );
  await expect(page).toHaveURL(/\/recipes\/new$/);
  await expect(page.getByLabel("Recipe URL")).toHaveValue(url);
  await expect(page.getByLabel("Caption", { exact: true })).toHaveValue(text);
});
