import { expect, type Page, test } from "@playwright/test";
import { readFileSync } from "node:fs";

import { formatDay } from "../src/lib/format";
import { addDays, today, weekStartOf } from "../src/server/domain/week";

import { STATE_FILE, USERS } from "./global-setup";

// The grid replaces the day columns from the `xl` breakpoint up.
test.use({
  viewport: { width: 1440, height: 900 },
  isMobile: false,
  hasTouch: false,
  deviceScaleFactor: 1,
});

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

test("lays the week out as a grid on desktop, on the Plan and Week pages", async ({
  page,
}) => {
  const { recipe } = state();
  await signIn(page, USERS.alex);

  // Next week, so the other specs' meals for this week stay as they expect.
  const week = addDays(weekStartOf(today()), 7);
  const date = addDays(week, 2);
  await page.goto(`/plan/${week}`);

  const grid = page.getByRole("table", { name: "Plan for the week" });
  await expect(grid.getByRole("rowheader")).toHaveCount(7);
  await expect(grid.getByRole("columnheader", { name: "Lunch" })).toBeVisible();

  const lunch = grid.getByRole("cell", {
    name: `Lunch, ${formatDay(date)}`,
  });
  await lunch
    .getByRole("button", { name: `Add lunch, ${formatDay(date)}` })
    .click();
  await page.getByRole("dialog").getByLabel("Search recipes").fill(recipe.name);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: new RegExp(recipe.name) })
    .click();
  const planned = lunch
    .getByTestId("grid-meal")
    .filter({ hasText: recipe.name });
  await expect(planned).toHaveCount(1);

  await page.getByRole("link", { name: "See the week" }).click();
  await expect(page).toHaveURL(`/week/${week}`);
  const weekGrid = page.getByRole("table", { name: "The week" });
  await expect(weekGrid.getByRole("rowheader")).toHaveCount(7);
  await expect(
    weekGrid
      .getByRole("cell", { name: `Lunch, ${formatDay(date)}` })
      .getByTestId("grid-meal")
      .filter({ hasText: recipe.name })
  ).toHaveCount(1);

  // The day cards are hidden here, so fasting is set from the grid's day.
  // The day after has nothing planned, so there's nothing to confirm.
  const fast = weekGrid
    .getByRole("rowheader", { name: new RegExp(formatDay(addDays(date, 1))) })
    .getByRole("button", { name: "Fast" });
  await fast.click();
  await expect(fast).toHaveAttribute("aria-pressed", "true");
  await fast.click();
  await expect(fast).toHaveAttribute("aria-pressed", "false");

  // Leave next week empty again.
  await page.goto(`/plan/${week}`);
  await planned
    .getByRole("button", { name: `Options for ${recipe.name}` })
    .click();
  await planned.getByRole("button", { name: "Remove" }).click();
  await expect(planned).toHaveCount(0);
});
