"use client";

import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, undefined);

  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-ink px-4">
      <form
        action={formAction}
        className="w-full max-w-sm overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl"
      >
        <div className="h-1.5 bg-brand" />
        <div className="space-y-5 p-6">
          <div>
            <p className="text-xs font-bold tracking-widest text-brand uppercase">MG</p>
            <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Warranty Self-Audit</h1>
            <p className="mt-1 text-sm text-neutral-500">
              Sign in with the account your warranty officer set up for you.
            </p>
          </div>

          <div className="space-y-1">
            <label htmlFor="email" className="text-sm font-medium text-neutral-700">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="password" className="text-sm font-medium text-neutral-700">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
            />
          </div>

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
          >
            {pending ? "Signing in..." : "Sign in"}
          </button>
        </div>
      </form>
    </main>
  );
}
