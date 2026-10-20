"use client";

import { type FormEvent, startTransition, useActionState } from "react";
import { CircleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

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
    <form onSubmit={submit} className="space-y-5">
      {next && <input type="hidden" name="next" value={next} />}
      <Field label="Email">
        <Input
          name="email"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          aria-invalid={state.error ? true : undefined}
        />
      </Field>
      <Field label="Password">
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={state.error ? true : undefined}
        />
      </Field>
      {state.error && (
        <div className="flex items-start gap-2.5 rounded-control bg-danger-soft px-3.5 py-3 text-danger">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p role="alert" className="text-sm font-medium">
            {state.error}
          </p>
        </div>
      )}
      <Button type="submit" size="lg" block disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
};
