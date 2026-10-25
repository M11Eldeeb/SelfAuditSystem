"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { logout } from "@/app/actions/auth";
import type { CurrentUser } from "@/lib/auth";
import { NotificationBell } from "@/components/notification-bell";
import { SettingsMenu } from "@/components/settings-menu";
import { SIDEBAR_KEY, SITE_NAME } from "@/lib/site";
import { NavIcon } from "@/components/nav-icons";

type NavLink = {
  href: string;
  label: string;
  /** Other path prefixes that also belong to this tab. */
  match?: string[];
  /** Small tag after the label, e.g. "Soon" for a tab that is not open yet. */
  badge?: string;
};
type NavNotifications = {
  count: number;
  items: {
    id: string;
    kind: "feedback" | "reply" | "audit" | "task";
    title: string;
    detail: string;
    href: string;
    at: string;
    ageDays?: number;
    urgent?: boolean;
  }[];
};

/**
 * Desktop sidebar: docked on the left and shown by default; people can hide it (the choice is kept in this browser).
 * The <html data-sidebar="closed"> attribute drives the layout (globals.css) and is set before first paint by
 * SIDEBAR_INIT_SCRIPT (root layout), so the page never jumps.
 */
const DESKTOP = "(min-width: 1280px)"; // keep in sync with globals.css (docked sidebar)

// Longest matching href wins, so a parent index route (e.g. "/admin") does
// not stay highlighted once you're on a more specific nested route (e.g.
// "/admin/cycles") that also starts with "/admin".
function activeHrefFor(pathname: string, links: NavLink[]) {
  const matches = links.flatMap((link) =>
    [link.href, ...(link.match ?? [])]
      .filter((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
      .map((prefix) => ({ href: link.href, length: prefix.length }))
  );
  return matches.sort((a, b) => b.length - a.length)[0]?.href;
}

// Officers manage branches and users (and their own password, from their row
// there); everyone else has just their own password.
function settingsLinksFor(user: CurrentUser): NavLink[] {
  return user.role === "officer"
    ? [
        { href: "/admin/branches", label: "Branches & Users" },
        { href: "/admin/emails", label: "Email settings" },
      ]
    : [{ href: "/account/password", label: "Change password" }];
}

function SidebarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7.75 4v12" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function NavList({ links, activeHref, animateIn }: { links: NavLink[]; activeHref?: string; animateIn?: boolean | null }) {
  return (
    <ul className="space-y-0.5">
      {links.map((link, i) => {
        const active = link.href === activeHref;
        return (
          <li
            key={link.href}
            style={animateIn == null ? undefined : { transitionDelay: animateIn ? `${80 + i * 35}ms` : "0ms" }}
            className={
              animateIn == null ? undefined : `transition-all duration-300 ease-out motion-reduce:transition-none ${animateIn ? "translate-x-0 opacity-100" : "-translate-x-3 opacity-0"}`
            }
          >
            <Link
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex items-center gap-2 rounded-lg px-3 py-2 text-[14px] leading-snug font-medium transition-colors ${
                active ? "bg-white/10 text-white ring-1 ring-white/10" : "text-neutral-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-brand" />}
              <NavIcon href={link.href} label={link.label} />
              <span className="min-w-0 flex-1">{link.label}</span>
              {link.badge && (
                <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-neutral-300 uppercase ring-1 ring-white/10">{link.badge}</span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function NavBar({
  user,
  links,
  notifications,
}: {
  user: CurrentUser;
  links: NavLink[];
  /** Initial bell state from the server; omit for roles that have no notifications. */
  notifications?: NavNotifications;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false); // phone / tablet drawer
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

  /** Desktop: hide / show the docked sidebar. Phone: open the drawer. */
  function toggleMenu() {
    if (!window.matchMedia(DESKTOP).matches) return setOpen(true);
    const root = document.documentElement;
    const closed = root.dataset.sidebar !== "closed";
    if (closed) root.dataset.sidebar = "closed";
    else delete root.dataset.sidebar;
    try {
      localStorage.setItem(SIDEBAR_KEY, closed ? "closed" : "open");
    } catch {
      // private window: the choice lasts for this page only
    }
  }

  const activeHref = activeHrefFor(pathname, links);
  const activeLabel = links.find((l) => l.href === activeHref)?.label;
  const displayName = user.full_name?.trim() || user.email;

  return (
    <>
      {/* Docked sidebar (desktop). Hidden with the top bar's sidebar button or its own. */}
      <aside aria-label="Main menu" className="app-sidebar chrome-dark fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-white/10 bg-linear-to-b from-brand-ink-soft to-brand-ink print:hidden xl:flex">
        <div className="h-[3px] bg-linear-to-r from-brand via-brand-light to-brand" />
        <div className="flex items-center justify-between gap-2 px-4 py-3.5">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <Image src="/mg-logo.png" alt="MG" width={1037} height={1024} priority className="h-8 w-auto shrink-0 drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]" />
            <span className="text-[13px] leading-tight font-semibold text-white">
              MG Warranty
              <span className="block text-[11px] font-medium tracking-wide text-neutral-400 uppercase">Management</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={toggleMenu}
            aria-label="Hide sidebar"
            title="Hide sidebar"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-400 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-brand"
          >
            <SidebarIcon />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-3">
          <NavList links={links} activeHref={activeHref} />
        </nav>
        <div className="border-t border-white/10 px-4 py-3 text-xs">
          <p className="truncate text-neutral-300" title={user.email}>
            {displayName}
          </p>
        </div>
      </aside>

      <header className="chrome-dark sticky top-0 z-20 print:hidden border-b border-white/10 bg-linear-to-b from-brand-ink-soft/92 to-brand-ink/90 shadow-lg shadow-black/10 backdrop-blur-md backdrop-saturate-150">
        <div className="h-[3px] bg-linear-to-r from-brand via-brand-light to-brand" />
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={toggleMenu}
              aria-label="Show or hide the menu"
              aria-expanded={open}
              aria-controls="app-drawer"
              title="Show / hide menu"
              className="app-menu-toggle flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-neutral-300 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <span className="xl:hidden">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                </svg>
              </span>
              <span className="hidden xl:block">
                <SidebarIcon />
              </span>
            </button>
            {/* The brand shows here only while the sidebar (which carries it) is not on screen. */}
            <span className="app-topbar-brand flex shrink-0 items-center gap-2.5 whitespace-nowrap">
              <Image src="/mg-logo.png" alt="MG" width={1037} height={1024} priority className="h-8 w-auto drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]" />
              <span className="hidden text-sm font-semibold tracking-wide text-white uppercase md:inline">{SITE_NAME}</span>
            </span>
            {activeLabel && (
              <span className="hidden min-w-0 items-center gap-3 truncate text-sm font-medium text-neutral-300 sm:flex">
                <span className="app-topbar-brand h-4 w-px bg-white/15" aria-hidden="true" />
                {activeLabel}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <span className="mr-1 hidden max-w-[9rem] truncate text-sm whitespace-nowrap text-neutral-400 md:inline" title={user.email}>
              {displayName}
            </span>
            {notifications && (
              <NotificationBell
                initial={notifications}
                feedbackHref={user.role === "officer" ? "/admin/feedbacks" : "/audit/feedback"}
                feedbackLabel={user.role === "officer" ? "All feedback" : "My feedback"}
                tasksHref={user.role === "officer" ? "/admin/dashboard?tab=tasks" : "/audit/dashboard?tab=tasks"}
              />
            )}
            <SettingsMenu links={settingsLinksFor(user)} />
            <form action={logout}>
              <button type="submit" className="rounded-md px-2.5 py-1 text-sm font-medium whitespace-nowrap text-neutral-300 transition hover:bg-white/5 hover:text-white">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Phone / tablet drawer: always mounted so it can animate both in and out; inert while closed keeps it out of tab
          order and from assistive tech. It sits outside <header> on purpose: the header's backdrop-filter would
          otherwise become the containing block of this fixed overlay and shrink it to the bar. */}
      <div className={`chrome-dark fixed inset-0 z-40 xl:hidden print:hidden ${open ? "" : "pointer-events-none"}`} inert={!open}>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className={`absolute inset-0 bg-black/55 backdrop-blur-[2px] transition-opacity duration-300 motion-reduce:transition-none ${open ? "opacity-100" : "opacity-0"}`}
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
              <span className="text-xs font-semibold tracking-wider text-neutral-300 uppercase">{SITE_NAME}</span>
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
            <NavList links={links} activeHref={activeHref} animateIn={open} />
          </nav>
          <div className="border-t border-white/10 px-4 py-3 text-xs text-neutral-500">
            <p className="truncate text-neutral-400" title={user.email}>
              {displayName}
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
