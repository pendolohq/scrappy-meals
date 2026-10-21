import { type NextRequest } from "next/server";

import { MealieError, MealieUnavailableError } from "@/server/mealie/client";
import { listProducts, searchRecipes } from "@/server/mealie/recipes";
import { userRoute } from "@/server/session";

export const GET = userRoute(async (req: NextRequest) => {
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 100);
  // The Add dialog's Product tab starts from the latest products, no search.
  const products = req.nextUrl.searchParams.get("products") === "1";
  try {
    return Response.json(
      products
        ? await listProducts({ perPage: 8 })
        : await searchRecipes(q, { perPage: 20 })
    );
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
