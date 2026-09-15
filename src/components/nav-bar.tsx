"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/actions/auth";
import type { CurrentUser } from "@/lib/auth";

export function NavBar({
  user,
  links,
}: {
  user: CurrentUser;
  links: { href: string; label: string }[];
}) {
  const pathname = usePathname();

  // Longest matching href wins, so a parent index route (e.g. "/admin") does
  // not stay highlighted once you're on a more specific nested route (e.g.
  // "/admin/cycles") that also starts with "/admin".
  const activeHref = links
    .filter((link) => pathname === link.href || pathname.startsWith(`${link.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  const displayName = user.full_name?.trim() || user.email;

  return (
    <header className="sticky top-0 z-20 border-b border-black/40 bg-linear-to-b from-brand-ink-soft to-brand-ink shadow-lg shadow-black/10">
      <div className="h-[3px] bg-linear-to-r from-brand via-brand-light to-brand" />
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-5">
          <span className="flex shrink-0 items-center gap-2.5 whitespace-nowrap">
            <Image src="/mg-logo.png" alt="MG" width={1037} height={1024} priority className="h-8 w-auto drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]" />
            <span className="hidden text-sm font-semibold tracking-wide text-white uppercase lg:inline">
              Self Audit
            </span>
          </span>
          <nav className="flex min-w-0 items-center gap-0.5">
            {links.map((link) => {
              const active = link.href === activeHref;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative rounded-md px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
                    active
                      ? "text-white"
                      : "text-neutral-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {active && (
                    <span className="absolute inset-0 rounded-md bg-white/10 ring-1 ring-white/10" />
                  )}
                  <span className="relative">{link.label}</span>
                  {active && (
                    <span className="absolute inset-x-2.5 -bottom-3 h-[2px] rounded-full bg-brand" />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="max-w-[9rem] truncate text-sm whitespace-nowrap text-neutral-400" title={user.email}>
            {displayName}
          </span>
          <Link
            href="/account/password"
            className="text-sm font-medium whitespace-nowrap text-neutral-300 transition hover:text-white"
          >
            Change password
          </Link>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-md px-2.5 py-1 text-sm font-medium whitespace-nowrap text-neutral-300 transition hover:bg-white/5 hover:text-white"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
