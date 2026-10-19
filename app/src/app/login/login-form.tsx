"use client";

import { useActionState } from "react";

import { login, type LoginState } from "./actions";

export const LoginForm = ({ next }: { next?: string }) => {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      <label className="block">
        <span className="text-sm text-muted">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2"
        />
      </label>
      <label className="block">
        <span className="text-sm text-muted">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2"
        />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-accent px-3 py-2 font-medium text-white disabled:opacity-60 dark:text-stone-900"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
};
