"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { logout } from "@/app/actions/auth";
import type { CurrentUser } from "@/lib/auth";

type NavLink = { href: string; label: string };

// Longest matching href wins, so a parent index route (e.g. "/admin") does
// not stay highlighted once you're on a more specific nested route (e.g.
// "/admin/cycles") that also starts with "/admin".
function activeHrefFor(pathname: string, links: NavLink[]) {
  return links
    .filter((link) => pathname === link.href || pathname.startsWith(`${link.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

export function NavBar({
  user,
  links,
  settingsHref,
}: {
  user: CurrentUser;
  links: NavLink[];
  /** Optional Settings link shown next to Sign out (officers: Branches & Users). */
  settingsHref?: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [lastPathname, setLastPathname] = useState(pathname);

  // Close the drawer after navigating. Adjusting state during render (rather
  // than in an effect) avoids a cascading re-render.
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const activeHref = activeHrefFor(pathname, links);
  const activeLabel = links.find((l) => l.href === activeHref)?.label;
  const onSettings = !!settingsHref && (pathname === settingsHref || pathname.startsWith(`${settingsHref}/`));
  const displayName = user.full_name?.trim() || user.email;

  return (
    <header className="sticky top-0 z-20 print:hidden border-b border-black/40 bg-linear-to-b from-brand-ink-soft to-brand-ink shadow-lg shadow-black/10">
      <div className="h-[3px] bg-linear-to-r from-brand via-brand-light to-brand" />
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            aria-expanded={open}
            aria-controls="app-drawer"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-neutral-300 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </button>
          <span className="flex shrink-0 items-center gap-2.5 whitespace-nowrap">
            <Image src="/mg-logo.png" alt="MG" width={1037} height={1024} priority className="h-8 w-auto drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]" />
            <span className="hidden text-sm font-semibold tracking-wide text-white uppercase xl:inline">
              MG Warranty Management
            </span>
          </span>
          {activeLabel && (
            <span className="hidden min-w-0 items-center gap-3 truncate text-sm font-medium text-neutral-300 sm:flex">
              <span className="h-4 w-px bg-white/15" aria-hidden="true" />
              {activeLabel}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden max-w-[9rem] truncate text-sm whitespace-nowrap text-neutral-400 sm:inline" title={user.email}>
            {displayName}
          </span>
          {/* Officers can change their own password from their row in Settings
              (Branches & Users) instead - branch admins have no other route
              to it, so they keep this link. */}
          {user.role !== "officer" && (
            <Link
              href="/account/password"
              className="text-sm font-medium whitespace-nowrap text-neutral-300 transition hover:text-white"
            >
              Change password
            </Link>
          )}
          {settingsHref && (
            <Link
              href={settingsHref}
              aria-current={onSettings ? "page" : undefined}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium whitespace-nowrap transition ${
                onSettings ? "bg-white/10 text-white ring-1 ring-white/10" : "text-neutral-300 hover:bg-white/5 hover:text-white"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <circle cx="10" cy="10" r="2.75" stroke="currentColor" strokeWidth="1.5" />
                <path
                  d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              Settings
            </Link>
          )}
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

      {/* Drawer: always mounted so it can animate both in and out; inert while
          closed keeps it out of tab order and from assistive tech. */}
      <div className={`fixed inset-0 z-40 ${open ? "" : "pointer-events-none"}`} inert={!open}>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className={`absolute inset-0 bg-black/55 backdrop-blur-[2px] transition-opacity duration-300 motion-reduce:transition-none ${
            open ? "opacity-100" : "opacity-0"
          }`}
        />
        <aside
          id="app-drawer"
          aria-label="Main menu"
          className={`absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-white/10 bg-linear-to-b from-brand-ink-soft to-brand-ink shadow-2xl shadow-black/50 transition-transform duration-300 ease-out motion-reduce:transition-none ${
            open ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="h-[3px] bg-linear-to-r from-brand via-brand-light to-brand" />
          <div className="flex items-center justify-between px-4 py-3">
            <span className="flex items-center gap-2.5">
              <Image src="/mg-logo.png" alt="" width={1037} height={1024} className="h-7 w-auto" />
              <span className="text-xs font-semibold tracking-wider text-neutral-300 uppercase">Menu</span>
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 transition hover:bg-white/10 hover:text-white"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto px-3 py-2">
            <ul className="space-y-1">
              {links.map((link, i) => {
                const active = link.href === activeHref;
                return (
                  <li
                    key={link.href}
                    style={{ transitionDelay: open ? `${80 + i * 35}ms` : "0ms" }}
                    className={`transition-all duration-300 ease-out motion-reduce:transition-none ${
                      open ? "translate-x-0 opacity-100" : "-translate-x-3 opacity-0"
                    }`}
                  >
                    <Link
                      href={link.href}
                      aria-current={active ? "page" : undefined}
                      className={`relative flex items-center rounded-lg px-3 py-2.5 text-[15px] font-medium transition-colors ${
                        active ? "bg-white/10 text-white ring-1 ring-white/10" : "text-neutral-400 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-brand" />}
                      {link.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="border-t border-white/10 px-4 py-3 text-xs text-neutral-500">
            <p className="truncate text-neutral-400" title={user.email}>
              {displayName}
            </p>
          </div>
        </aside>
      </div>
    </header>
  );
}
