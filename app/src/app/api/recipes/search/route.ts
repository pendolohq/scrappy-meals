import { type NextRequest } from "next/server";

import { MealieError } from "@/server/mealie/client";
import { searchRecipes } from "@/server/mealie/recipes";
import { userRoute } from "@/server/session";

export const dynamic = "force-dynamic";

export const GET = userRoute(async (req: NextRequest) => {
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 100);
  const page = Math.max(
    1,
    Math.min(100, Number(req.nextUrl.searchParams.get("page")) || 1)
  );
  try {
    return Response.json(await searchRecipes(q, { page, perPage: 20 }));
  } catch (err) {
    console.error("recipe search failed", err);
    const status = err instanceof MealieError ? 502 : 500;
    return Response.json(
      { error: "Mealie is not reachable right now" },
      { status }
    );
  }
});
