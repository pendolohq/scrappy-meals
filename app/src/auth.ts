import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import { getDb } from "@/server/db/client";
import { createRateLimiter } from "@/server/rate-limit";
import {
  findUserById,
  normaliseEmail,
  verifyCredentials,
} from "@/server/users";

import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: { id: string; name: string; email: string };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    sv?: number;
  }
}

export class RateLimitedError extends CredentialsSignin {
  code = "rate_limited";
}

const WINDOW_MS = 15 * 60 * 1000;
const perEmail = createRateLimiter({ limit: 10, windowMs: WINDOW_MS });
const perIp = createRateLimiter({ limit: 30, windowMs: WINDOW_MS });

const credentialsSchema = z.object({
  email: z.string().min(1).max(320),
  password: z.string().min(1).max(1024),
});

function clientIp(request: Request): string {
  // Caddy sets X-Forwarded-For; the app port is not published, so it can't be spoofed from outside.
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown"
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) {
          return null;
        }
        const email = normaliseEmail(parsed.data.email);

        if (!perIp.hit(clientIp(request)) || !perEmail.hit(email)) {
          throw new RateLimitedError();
        }

        const user = await verifyCredentials(
          getDb(),
          email,
          parsed.data.password
        );
        if (!user) {
          return null;
        }
        perEmail.reset(email);
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          sv: user.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // Sign-in: `user` is what authorize() returned.
        return { ...token, uid: user.id, sv: (user as { sv: number }).sv };
      }
      // Every later request: drop the session if the user was removed or changed their password.
      if (!token.uid) {
        return null;
      }
      const current = await findUserById(getDb(), token.uid);
      if (!current || current.sessionVersion !== token.sv) {
        return null;
      }
      return { ...token, name: current.name, email: current.email };
    },
    session({ session, token }) {
      session.user = {
        ...session.user,
        id: token.uid!,
        name: token.name ?? "",
        email: token.email ?? "",
      };
      return session;
    },
  },
});
