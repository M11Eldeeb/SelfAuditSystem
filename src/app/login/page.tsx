"use client";

import Image from "next/image";
import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, undefined);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-brand-ink px-4">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(46rem 28rem at 18% 8%, color-mix(in srgb, var(--brand) 28%, transparent), transparent 60%), radial-gradient(34rem 22rem at 100% 100%, color-mix(in srgb, var(--brand) 16%, transparent), transparent 55%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <form
        action={formAction}
        className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl shadow-black/50"
      >
        <div className="h-1.5 bg-linear-to-r from-brand via-brand-light to-brand" />
        <div className="space-y-6 p-7">
          <div className="space-y-3">
            <Image src="/mg-logo.png" alt="MG" width={1037} height={1024} priority className="h-12 w-auto" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-neutral-900">MG Warranty Management</h1>
              <p className="mt-1 text-sm text-neutral-500">
                Sign in with the account your warranty officer set up for you.
              </p>
            </div>
          </div>

          <div className="space-y-4">
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
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
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
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
              />
            </div>
          </div>

          {state?.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-brand px-3 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition hover:bg-brand-dark hover:shadow-md hover:shadow-brand/30 disabled:opacity-50"
          >
            {pending ? "Signing in..." : "Sign in"}
          </button>
        </div>
      </form>
    </main>
  );
}
