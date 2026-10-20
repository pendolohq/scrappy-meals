import { NextResponse } from "next/server";

import { auth } from "@/auth";

const PUBLIC_PATHS = [
  "/login",
  "/offline",
  "/sw.js",
  "/api/auth",
  "/api/health",
  "/manifest.webmanifest",
];

export const proxy = auth((req) => {
  const { pathname } = req.nextUrl;
  if (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  ) {
    return;
  }
  if (req.auth?.user) {
    return;
  }
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const login = new URL("/login", req.nextUrl);
  if (pathname !== "/") {
    login.searchParams.set("next", pathname + req.nextUrl.search);
  }
  return NextResponse.redirect(login);
});

// Proxy always runs on Node.js, which the session check needs (it reads the database).
// Icons and the install screenshots (sample data) are fetched by the browser's
// install dialog, signed in or not.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons/|screenshots/).*)",
  ],
};
