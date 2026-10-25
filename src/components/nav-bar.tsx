"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { logout } from "@/app/actions/auth";
import type { CurrentUser } from "@/lib/auth";
import { NotificationBell } from "@/components/notification-bell";
import { SettingsMenu } from "@/components/settings-menu";
import { SIDEBAR_KEY } from "@/lib/site";
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
    <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7.75 4v12" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

const ROLE_LABEL: Record<string, string> = {
  officer: "Warranty officer",
  branch_admin: "Warranty admin",
  service_manager: "Service manager",
  finance: "Finance",
  technical: "Technical team",
  workshop_supervisor: "Workshop supervisor",
  team_leader: "Team leader",
  technician: "Technician",
};

/**
 * Sidebar rows (Apple sidebars.md): a symbol in the app's accent colour, the label, an optional count capsule. The
 * current page gets a soft grey selection, not a coloured block.
 */
function NavList({ links, activeHref, animateIn }: { links: NavLink[]; activeHref?: string; animateIn?: boolean | null }) {
  return (
    <ul className="space-y-px">
      {links.map((link, i) => {
        const active = link.href === activeHref;
        return (
          <li
            key={link.href}
            style={animateIn == null ? undefined : { transitionDelay: animateIn ? `${60 + i * 25}ms` : "0ms" }}
            className={animateIn == null ? undefined : `transition-all duration-300 ease-out motion-reduce:transition-none ${animateIn ? "translate-x-0 opacity-100" : "-translate-x-2 opacity-0"}`}
          >
            <Link
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-8 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] leading-snug transition-colors ${
                active ? "bg-neutral-900/[0.07] font-semibold text-neutral-900" : "font-medium text-neutral-700 hover:bg-neutral-900/[0.04] hover:text-neutral-900"
              }`}
            >
              <span className="text-brand">
                <NavIcon href={link.href} label={link.label} />
              </span>
              <span className="min-w-0 flex-1">{link.label}</span>
              {link.badge && <span className="shrink-0 rounded-full bg-neutral-900/[0.07] px-1.5 py-px text-[11px] font-semibold tabular-nums text-neutral-600">{link.badge}</span>}
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
  const roleLabel = `${ROLE_LABEL[user.role] ?? ""}${user.viewOnly ? " · view only" : ""}`;
  const initials = displayName
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  const brand = (
    <Link href="/" className="flex min-w-0 items-center gap-2.5">
      <Image src="/mg-logo.png" alt="MG" width={1037} height={1024} priority className="h-7 w-auto shrink-0" />
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[14px] font-semibold text-neutral-900">MG Warranty</span>
        <span className="block truncate text-[12px] text-neutral-500">Management</span>
      </span>
    </Link>
  );

  const account = (
    <div className="flex items-center gap-2.5 px-2.5 py-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-900/[0.07] text-[11px] font-semibold text-neutral-700">{initials}</span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[13px] font-medium text-neutral-900" title={user.email}>
          {displayName}
        </span>
        {roleLabel && <span className="block truncate text-[12px] text-neutral-500">{roleLabel}</span>}
      </span>
    </div>
  );

  return (
    <>
      {/* Docked sidebar (wide screens): a floating glass panel, as on iPad and Mac. Hidden with its own button or the top bar's. */}
      <aside
        aria-label="Main menu"
        className="app-sidebar app-glass fixed top-2 bottom-2 left-2 z-30 hidden w-60 flex-col rounded-2xl shadow-[0_8px_30px_-12px_rgba(0,0,0,0.12)] ring-1 ring-neutral-900/[0.06] print:hidden xl:flex"
      >
        <div className="flex items-center justify-between gap-2 px-3.5 pt-3.5 pb-3">
          {brand}
          <button
            type="button"
            onClick={toggleMenu}
            aria-label="Hide sidebar"
            title="Hide sidebar"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-neutral-900/[0.05] hover:text-neutral-900"
          >
            <SidebarIcon />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          <NavList links={links} activeHref={activeHref} />
        </nav>
        <div className="border-t border-neutral-900/[0.06] p-1.5">{account}</div>
      </aside>

      <header className="app-glass sticky top-0 z-20 border-b border-neutral-900/[0.06] print:hidden">
        <div className="flex h-[52px] items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={toggleMenu}
              aria-label="Show or hide the menu"
              aria-expanded={open}
              aria-controls="app-drawer"
              title="Show / hide menu"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-neutral-600 transition hover:bg-neutral-900/[0.05] hover:text-neutral-900"
            >
              <span className="xl:hidden">
                <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </span>
              <span className="hidden xl:block">
                <SidebarIcon />
              </span>
            </button>
            {/* The brand shows here only while the sidebar (which carries it) is not on screen. */}
            <span className="app-topbar-brand flex min-w-0 items-center">{brand}</span>
            {activeLabel && (
              <span className="hidden min-w-0 items-center gap-2.5 truncate text-[15px] font-semibold text-neutral-900 sm:flex">
                <span className="app-topbar-brand h-4 w-px bg-neutral-300" aria-hidden="true" />
                {activeLabel}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
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
              <button type="submit" className="rounded-lg px-2.5 py-1.5 text-[13px] font-medium whitespace-nowrap text-neutral-600 transition hover:bg-neutral-900/[0.05] hover:text-neutral-900">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Phone / tablet drawer: always mounted so it can animate both in and out; inert while closed keeps it out of tab
          order and from assistive tech. It sits outside <header> on purpose: the header's backdrop-filter would
          otherwise become the containing block of this fixed overlay and shrink it to the bar. */}
      <div className={`fixed inset-0 z-40 xl:hidden print:hidden ${open ? "" : "pointer-events-none"}`} inert={!open}>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className={`absolute inset-0 bg-black/30 transition-opacity duration-300 motion-reduce:transition-none ${open ? "opacity-100" : "opacity-0"}`}
        />
        <aside
          id="app-drawer"
          aria-label="Main menu"
          className={`absolute top-2 bottom-2 left-2 flex w-72 max-w-[85vw] flex-col rounded-2xl bg-[var(--surface)] shadow-2xl ring-1 ring-neutral-900/[0.06] transition-transform duration-300 ease-out motion-reduce:transition-none ${
            open ? "translate-x-0" : "-translate-x-[110%]"
          }`}
        >
          <div className="flex items-center justify-between gap-2 px-3.5 pt-3.5 pb-3">
            {brand}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-neutral-900/[0.05] hover:text-neutral-900"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto px-2 pb-2">
            <NavList links={links} activeHref={activeHref} animateIn={open} />
          </nav>
          <div className="border-t border-neutral-900/[0.06] p-1.5">{account}</div>
        </aside>
      </div>
    </>
  );
}
