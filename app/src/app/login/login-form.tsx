"use client";

import { type FormEvent, startTransition, useActionState } from "react";

import { login, type LoginState } from "./actions";

export const LoginForm = ({ next }: { next?: string }) => {
  const [state, action, pending] = useActionState<LoginState, FormData>(
    login,
    {}
  );
  // Submitted by hand rather than with <form action>: React resets a form
  // after its action, which would clear the email after a wrong password.
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(() => action(form));
  };
  return (
    <form onSubmit={submit} className="space-y-4">
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
        className="w-full rounded-lg bg-accent px-3 py-2 font-medium text-accent-foreground disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
};
