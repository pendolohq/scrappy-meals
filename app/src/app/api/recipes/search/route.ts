import { type NextRequest } from "next/server";

import {
  orderCategoryChips,
  orderTagChips,
  parsePickerSearch,
} from "@/server/domain/discover";
import { MealieError, MealieUnavailableError } from "@/server/mealie/client";
import { discoverRecipes, listOrganizers } from "@/server/mealie/recipes";
import { userRoute } from "@/server/session";

/**
 * The add-meal picker's results: Discover's filters plus a name search, a
 * page at a time. A route handler rather than an action so a search typed
 * over can be aborted. The chips come along, so the picker needs no
 * separate request when it opens.
 */
export const GET = userRoute(async (req: NextRequest) => {
  try {
    const organizers = await listOrganizers();
    const { page, ...filters } = parsePickerSearch(req.nextUrl.searchParams, {
      tags: organizers.tags.map((t) => t.slug),
      categories: organizers.categories.map((c) => c.slug),
    });
    const result = await discoverRecipes(filters, { page });
    return Response.json({
      ...result,
      tags: orderTagChips(organizers.tags, filters.tags),
      categories: orderCategoryChips(organizers.categories, filters.categories),
    });
  } catch (err) {
    console.error("recipe search failed", err);
    const fromMealie =
      err instanceof MealieError || err instanceof MealieUnavailableError;
    const status = fromMealie ? 502 : 500;
    return Response.json(
      { error: "Mealie is not reachable right now" },
      { status }
    );
  }
});
