import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import { getDb } from "@/server/db/client";
import { createSignInLimits } from "@/server/rate-limit";
import { refreshToken } from "@/server/session-token";
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

const limits = createSignInLimits();

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

        const ip = clientIp(request);
        if (!limits.allowed(email, ip)) {
          throw new RateLimitedError();
        }

        const user = await verifyCredentials(
          getDb(),
          email,
          parsed.data.password
        );
        if (!user) {
          limits.failed(email, ip);
          return null;
        }
        limits.succeeded(email, ip);
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
      return refreshToken(token, (id) => findUserById(getDb(), id));
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
