import { expect, type Page } from "@playwright/test";

import { formatDay } from "../src/lib/format";
import { weekStartOf } from "../src/server/domain/week";

/**
 * Adds a recipe to a day's slot from the Plan page, then opens that day's
 * week, where the specs look at it. The hash opens the phone's day carousel
 * on that day: otherwise it opens on today, with the day off to one side.
 */
export async function planMeal(
  page: Page,
  { date, slot, recipe }: { date: string; slot: string; recipe: string }
) {
  const week = weekStartOf(date);
  await page.goto(`/plan/${week}`);
  const day = page.locator(`section[aria-label="${formatDay(date)}"]`);
  await day.getByRole("button", { name: `Add ${slot.toLowerCase()}` }).click();
  await page.getByRole("dialog").getByLabel("Search recipes").fill(recipe);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: new RegExp(recipe) })
    .click();
  await expect(
    day
      .getByRole("group", { name: slot })
      .getByTestId("meal")
      .filter({ hasText: recipe })
      .last()
  ).toBeVisible();
  await page.goto(`/week/${week}#${date}`);
}
