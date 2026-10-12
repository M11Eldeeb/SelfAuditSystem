"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type Item = { id: string; title: string; detail: string; href: string; at: string };
type Notifications = { count: number; items: Item[] };

const POLL_MS = 60_000;

async function fetchNotifications(): Promise<Notifications | null> {
  try {
    const res = await fetch("/api/notifications", { cache: "no-store" });
    return res.ok ? ((await res.json()) as Notifications) : null;
  } catch {
    return null; // offline or a transient error: keep showing the last known state
  }
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

/**
 * Bell in the top bar with a red count badge. Starts from what the server
 * rendered, then re-checks every minute (while the tab is visible), whenever
 * the route changes, when opened, and when a page announces that it cleared a
 * notification ("notifications:refresh").
 */
export function NotificationBell({
  initial,
  viewAllHref,
  viewAllLabel,
}: {
  initial: Notifications;
  viewAllHref: string;
  viewAllLabel: string;
}) {
  const pathname = usePathname();
  const [data, setData] = useState<Notifications>(initial);
  const [open, setOpen] = useState(false);
  const [lastPathname, setLastPathname] = useState(pathname);
  const rootRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    void fetchNotifications().then((next) => {
      if (next) setData(next);
    });
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const timer = window.setInterval(onVisible, POLL_MS);
    window.addEventListener("notifications:refresh", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("notifications:refresh", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // Close the popover after navigating (state adjusted during render, not in an effect).
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setOpen(false);
  }

  // Re-check after every navigation (the page just visited may have cleared one).
  useEffect(() => {
    refresh();
  }, [pathname, refresh]);

  useEffect(() => {
    if (!open) return;
    refresh();
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, refresh]);

  const label = data.count > 99 ? "99+" : String(data.count);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={data.count > 0 ? `Notifications, ${data.count} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`relative flex h-9 w-9 items-center justify-center rounded-md transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
          open ? "bg-white/10 text-white" : "text-neutral-300 hover:bg-white/10 hover:text-white"
        }`}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M6 9.5a6 6 0 1112 0c0 3.6.9 5.2 1.8 6.2.3.3.1.8-.4.8H4.6c-.5 0-.7-.5-.4-.8C5.1 14.7 6 13.1 6 9.5z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M10 19.5a2.2 2.2 0 004 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        {data.count > 0 && (
          <span
            key={data.count}
            className="badge-pop absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[10px] leading-none font-bold text-white ring-2 ring-brand-ink"
          >
            {label}
          </span>
        )}
      </button>

      <div
        role="menu"
        aria-label="Notifications"
        inert={!open}
        className={`theme-follow absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] origin-top-right overflow-hidden rounded-xl border border-neutral-200 bg-white text-neutral-900 shadow-xl shadow-black/20 transition duration-200 ease-out motion-reduce:transition-none ${
          open ? "translate-y-0 scale-100 opacity-100" : "pointer-events-none -translate-y-1 scale-95 opacity-0"
        }`}
      >
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-2.5">
          <p className="text-sm font-semibold text-neutral-900">Notifications</p>
          {data.count > 0 && <span className="text-xs text-neutral-500">{data.count} new</span>}
        </div>

        {data.items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-neutral-500">You&apos;re all caught up.</p>
        ) : (
          <ul className="max-h-80 divide-y divide-neutral-100 overflow-y-auto">
            {data.items.map((n) => (
              <li key={n.id}>
                <Link
                  href={n.href}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="flex gap-3 px-4 py-3 transition-colors hover:bg-neutral-50"
                >
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-neutral-900">{n.title}</span>
                    <span className="block truncate text-xs text-neutral-500">{n.detail}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-neutral-500">{timeAgo(n.at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <Link
          href={viewAllHref}
          onClick={() => setOpen(false)}
          className="block border-t border-neutral-100 px-4 py-2.5 text-center text-sm font-medium text-brand transition-colors hover:bg-neutral-50"
        >
          {viewAllLabel}
        </Link>
      </div>
    </div>
  );
}
