"use server";

import { z } from "zod";

import { userAction } from "@/server/action";
import { discoverRecipes } from "@/server/mealie/recipes";

const slugs = z.array(z.string().max(100)).max(50);

/**
 * The next page of the Discover grid, for the filters the page was rendered
 * with. A read, but the grid loads one page at a time, so the actions'
 * one-at-a-time dispatch costs nothing and it gets userAction's checks.
 */
export const loadMoreRecipesAction = userAction(
  z.object({
    tags: slugs,
    categories: slugs,
    quick: z.boolean(),
    page: z.number().int().min(2).max(1000),
  }),
  async ({ page, ...filters }) => {
    const { items, nextPage } = await discoverRecipes(filters, { page });
    return { items, nextPage };
  }
);
