import { expect, type Page, test } from "@playwright/test";

import { formatDay } from "../src/lib/format";
import {
  addDays,
  isoWeekday,
  today,
  weekStartOf,
} from "../src/server/domain/week";

import { USERS } from "./global-setup";

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/week\/\d{4}-\d{2}-\d{2}$/);
}

// On a phone (the config's default device) the week shows one day at a time.
test("opens the week on today and moves between days from the strip", async ({
  page,
}) => {
  await signIn(page, USERS.alex);
  const now = today();
  const week = weekStartOf(now);
  const strip = page.getByRole("navigation", { name: "Days of the week" });
  const card = (date: string) =>
    page.locator(`section[aria-label="${formatDay(date)}"]`);
  // Cards are taller than the screen, so "in view" is about the swipe axis:
  // the day's card spans the viewport's width, the others are off to a side.
  const expectShown = (date: string) =>
    expect
      .poll(async () => {
        const box = await card(date).boundingBox();
        const width = page.viewportSize()?.width ?? 0;
        return box !== null && box.x >= 0 && box.x + box.width <= width;
      })
      .toBe(true);

  await expect(strip.getByRole("link")).toHaveCount(7);
  await expect(
    strip.getByRole("link", { name: `${formatDay(now)}, today` })
  ).toHaveAttribute("aria-current", "true");
  await expectShown(now);

  // Sunday, or Monday when today is Sunday.
  const other = addDays(week, isoWeekday(now) === 7 ? 0 : 6);
  await strip.getByRole("link", { name: formatDay(other) }).click();
  await expectShown(other);
  await expect(card(now)).not.toBeInViewport();
  await expect(
    strip.getByRole("link", { name: formatDay(other) })
  ).toHaveAttribute("aria-current", "true");
  await expect(page).toHaveURL(`/week/${week}#${other}`);

  // The hash brings the same day back on a reload.
  await page.reload();
  await expectShown(other);

  // Another week opens on its Monday.
  await page.getByRole("link", { name: "Next week" }).click();
  const next = addDays(week, 7);
  await expect(page).toHaveURL(`/week/${next}`);
  await expectShown(next);

  // A repeated hash, as Next.js can leave after a client navigation, still
  // names the day, and goes back to one.
  await page.goto(`/week/${week}#${other}#${other}`);
  await expectShown(other);
  await expect(page).toHaveURL(`/week/${week}#${other}`);
});
