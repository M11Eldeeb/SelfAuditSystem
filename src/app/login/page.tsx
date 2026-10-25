"use client";

import Image from "next/image";
import { useActionState } from "react";
import { login } from "./actions";

/**
 * Sign in - a single quiet column on the grouped grey background (Apple's sign-in pattern): the MG badge, a title,
 * the two fields joined in one rounded group, one MG red button.
 */
export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, undefined);
  const field =
    "block w-full bg-transparent px-4 py-3 text-[15px] text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus-visible:bg-neutral-50";

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4 py-10">
      <form action={formAction} className="w-full max-w-[360px] space-y-7">
        <div className="flex flex-col items-center text-center">
          <Image src="/mg-logo.png" alt="MG" width={1037} height={1024} priority className="h-14 w-auto" />
          <h1 className="mt-5 text-[26px] leading-tight font-semibold text-neutral-900">MG Warranty Management</h1>
          <p className="mt-1.5 text-[15px] text-neutral-500">Sign in with the account your warranty officer set up for you.</p>
        </div>

        <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-neutral-900/[0.08] focus-within:ring-2 focus-within:ring-brand/40">
          <label htmlFor="email" className="sr-only">
            Email or employee number
          </label>
          <input id="email" name="email" type="text" required autoComplete="username" placeholder="Email or employee number" className={field} />
          <div className="mx-4 h-px bg-neutral-200" />
          <label htmlFor="password" className="sr-only">
            Password
          </label>
          <input id="password" name="password" type="password" required autoComplete="current-password" placeholder="Password" className={field} />
        </div>

        {state?.error && (
          <p role="alert" className="text-center text-[14px] text-red-700">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-xl bg-brand px-4 py-3 text-[15px] font-semibold text-white transition hover:bg-brand-dark active:scale-[0.99] disabled:opacity-50"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>

        <p className="text-center text-[12px] text-neutral-400">Jiad Modern Motors · Warranty Department</p>
      </form>
    </main>
  );
}
