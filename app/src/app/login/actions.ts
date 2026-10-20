"use server";

import { AuthError, CredentialsSignin } from "next-auth";

import { signIn } from "@/auth";

import { safeNext } from "./safe-next";

export type LoginState = { error?: string };

export async function login(
  _prev: LoginState,
  form: FormData
): Promise<LoginState> {
  try {
    await signIn("credentials", {
      email: form.get("email"),
      password: form.get("password"),
      redirectTo: safeNext(form.get("next")),
    });
    return {};
  } catch (err) {
    if (err instanceof CredentialsSignin && err.code === "rate_limited") {
      return { error: "Too many attempts. Try again in 15 minutes." };
    }
    if (err instanceof AuthError) {
      return { error: "Invalid email or password." };
    }
    throw err; // includes the redirect on success
  }
}
