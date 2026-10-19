import { NextResponse } from "next/server";

import { auth } from "@/auth";

const PUBLIC_PATHS = ["/login", "/offline", "/sw.js", "/api/auth", "/api/health", "/manifest.webmanifest"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return;
  if (req.auth?.user) return;
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const login = new URL("/login", req.nextUrl);
  if (pathname !== "/") login.searchParams.set("next", pathname + req.nextUrl.search);
  return NextResponse.redirect(login);
});

export const config = {
  // Node runtime: the session check reads the database.
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/).*)"],
};
