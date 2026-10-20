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

test("plans a recipe from the Plan page and shows it on the week", async ({
  page,
}) => {
  const { recipe } = state();
  await signIn(page, USERS.alex);

  // This week or the next, depending on what the other specs left planned
  // (the rule itself is unit-tested in week.test.ts).
  await page.getByRole("link", { name: "Plan", exact: true }).click();
  const thisWeek = weekStartOf(today());
  await expect(page).toHaveURL(
    new RegExp(`/plan/(${thisWeek}|${addDays(thisWeek, 7)})$`)
  );
  const week = new URL(page.url()).pathname.split("/")[2];
  // Not today, so the smoke test's totals for today stay as they expect.
  const date =
    addDays(week, 6) === today() ? addDays(week, 5) : addDays(week, 6);

  const column = page.locator(`section[aria-label="${formatDay(date)}"]`);
  const lunch = column.getByRole("group", { name: "Lunch" });
  await lunch.getByRole("button", { name: "Add lunch" }).click();
  await page.getByRole("dialog").getByLabel("Search recipes").fill(recipe.name);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: new RegExp(recipe.name) })
    .click();
  const planned = lunch.getByTestId("meal").filter({ hasText: recipe.name });
  await expect(planned).toHaveCount(1);
  // Both people start at a full portion.
  await expect(planned).toContainText("Alex 1× · Sam 1×");

  await page.getByRole("link", { name: "See the week" }).click();
  await expect(page).toHaveURL(`/week/${week}`);
  const day = page.locator(`section[aria-label="${formatDay(date)}"]`);
  const meal = day
    .getByRole("group", { name: "Lunch" })
    .getByTestId("meal")
    .filter({ hasText: recipe.name });
  await expect(meal).toHaveCount(1);

  // An empty slot on the week leads back to the Plan page, at that day.
  await day.getByRole("link", { name: "Plan dinner" }).click();
  await expect(page).toHaveURL(`/plan/${week}#${date}`);

  // The smoke test expects only its own meal on this week's shopping list.
  await planned
    .getByRole("button", { name: `Options for ${recipe.name}` })
    .click();
  await planned.getByRole("button", { name: "Remove" }).click();
  await expect(planned).toHaveCount(0);
});
