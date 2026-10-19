import { cache } from "react";
import { redirect } from "next/navigation";

import { auth } from "@/auth";

import "server-only";

// The one place that decides who is signed in. Pages, layouts, server actions
// and route handlers all go through these helpers instead of calling auth().

export type SessionUser = { id: string; name: string; email: string };

/** The signed-in user for this request, or null. Cached for the request. */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const user = (await auth())?.user;
  return user?.id ? user : null;
});

/**
 * For pages and layouts. Each page that reads data calls it itself: a layout
 * doesn't always re-render on navigation, so it can't guard the pages below it.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

/** For route handlers: answers 401 unless someone is signed in. */
export function userRoute<Req extends Request, Ctx>(
  handler: (req: Req, ctx: Ctx, user: SessionUser) => Promise<Response>
): (req: Req, ctx: Ctx) => Promise<Response> {
  return async (req, ctx) => {
    const user = await currentUser();
    if (!user) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    return handler(req, ctx, user);
  };
}
