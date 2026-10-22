import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { cookies } from "next/headers";
import { z } from "zod";

import { getDb } from "@/server/db/client";
import {
  isKnownDevice,
  KNOWN_DEVICE_MAX_AGE,
  knownDeviceCookie,
  type Member,
  rememberDevice,
} from "@/server/known-device";
import { createSignInLimits, ipBucket } from "@/server/rate-limit";
import { refreshToken } from "@/server/session-token";
import {
  findUserByEmail,
  findUserById,
  normaliseEmail,
  verifyCredentials,
} from "@/server/users";

import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: { id: string; name: string; email: string };
  }
  interface User {
    /** Session version at sign-in; see refreshToken. */
    sv?: number;
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
  return ipBucket(
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown"
  );
}

const authSecret = () => process.env.AUTH_SECRET ?? "";
// As Auth.js decides for its own cookies.
const secureCookies = () => process.env.AUTH_URL?.startsWith("https:") ?? false;

async function knownDevice(email: string): Promise<boolean> {
  const secret = authSecret();
  const cookie = (await cookies()).get(
    knownDeviceCookie(secureCookies())
  )?.value;
  if (!secret || !cookie) {
    return false;
  }
  const user = await findUserByEmail(getDb(), email);
  return user !== undefined && isKnownDevice(cookie, user, secret);
}

async function rememberThisDevice(member: Member): Promise<void> {
  const secret = authSecret();
  if (!secret) {
    return;
  }
  const secure = secureCookies();
  const name = knownDeviceCookie(secure);
  const jar = await cookies();
  jar.set(name, rememberDevice(jar.get(name)?.value, member, secret), {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: KNOWN_DEVICE_MAX_AGE,
  });
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
        if (!limits.allowed(email, ip, await knownDevice(email))) {
          throw new RateLimitedError();
        }
        limits.attempt(email, ip);

        const user = await verifyCredentials(
          getDb(),
          email,
          parsed.data.password
        );
        if (!user) {
          return null;
        }
        limits.succeeded(email, ip);
        await rememberThisDevice({
          email,
          sessionVersion: user.sessionVersion,
        });
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
        return { ...token, uid: user.id, sv: user.sv };
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
