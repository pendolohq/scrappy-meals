import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

import { formatDay } from "../src/lib/format";
import { TIME_ZONE_COOKIE } from "../src/lib/time-zone";
import { today, weekStartOf } from "../src/server/domain/week";

import { STATE_FILE, USERS } from "./global-setup";
import { planMeal } from "./plan-meal";

// 26 hours apart, so at any moment at least one of them isn't on the server's
// date. The first is ahead of everywhere: it's "tomorrow" there for most of
// the server's day.
const zone = (() => {
  const server = today();
  return (
    ["Pacific/Kiritimati", "Etc/GMT+12"].find(
      (z) => today(new Date(), z) !== server
    ) ?? "Pacific/Kiritimati"
  );
})();
test.use({ timezoneId: zone });

const state = () =>
  JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
    recipe: { name: string };
  };

test("follows the device's date, not the server's", async ({
  page,
  context,
}) => {
  const { recipe } = state();
  const day = today(new Date(), zone);
  expect(day).not.toBe(today());

  // The login page already hands the zone over, so the first week after
  // signing in is the device's.
  await page.goto("/login");
  await expect
    .poll(async () => {
      const cookies = await context.cookies();
      return cookies.find((c) => c.name === TIME_ZONE_COOKIE)?.value;
    })
    .toBe(encodeURIComponent(zone));
  await page.getByLabel("Email").fill(USERS.alex.email);
  await page.getByLabel("Password").fill(USERS.alex.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(`/week/${weekStartOf(day)}`);

  const strip = page.getByRole("navigation", { name: "Days of the week" });
  await expect(
    strip.getByRole("link", { name: `${formatDay(day)}, today` })
  ).toHaveAttribute("aria-current", "true");

  // The device's today can be logged, even before the server reaches it.
  await planMeal(page, { date: day, slot: "Dinner", recipe: recipe.name });
  const meal = page
    .locator(`section[aria-label="${formatDay(day)}"]`)
    .getByTestId("meal")
    .filter({ hasText: recipe.name });
  const stuck = meal.getByRole("button", {
    name: new RegExp(`^Stuck to it: ${recipe.name}`),
  });
  await stuck.click();
  await expect(stuck).toHaveAttribute("aria-pressed", "true");

  // The other specs plan this week around the server's today and push its
  // shopping list, so leave nothing behind.
  await meal
    .getByRole("button", { name: `Options for ${recipe.name}` })
    .click();
  await meal.getByRole("button", { name: "Remove" }).click();
  await expect(meal).toHaveCount(0);
});
