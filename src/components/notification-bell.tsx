"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type Item = {
  id: string;
  kind: "feedback" | "reply" | "audit" | "task";
  title: string;
  detail: string;
  href: string;
  at: string;
  ageDays?: number;
  urgent?: boolean;
};
type Notifications = { count: number; items: Item[] };

const POLL_MS = 120_000;
/** Navigating around should not re-run the (heavy) task lookup every click. */
const MIN_REFRESH_GAP_MS = 20_000;
const AUTO_OPEN_KEY = "pending-tasks-popup-seen";

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

function ageBadgeClass(days: number): string {
  if (days >= 5) return "bg-red-50 text-red-700 ring-red-200";
  if (days >= 3) return "bg-amber-50 text-amber-800 ring-amber-200";
  return "bg-neutral-100 text-neutral-600 ring-neutral-200";
}

/**
 * Bell in the top bar with a red count badge: unread feedback / replies and
 * the viewer's pending tasks. Starts from what the server rendered (feedback
 * only - fast), then fetches the full list, and re-checks every two minutes
 * while the tab is visible, after navigation (rate limited), when opened, and
 * when a page announces that it cleared a notification
 * ("notifications:refresh"). Opens by itself once per browser session when
 * tasks are pending, like the old Tasks pill did.
 */
export function NotificationBell({
  initial,
  feedbackHref,
  feedbackLabel,
  tasksHref,
}: {
  initial: Notifications;
  feedbackHref: string;
  feedbackLabel: string;
  tasksHref: string;
}) {
  const pathname = usePathname();
  const [data, setData] = useState<Notifications>(initial);
  const [open, setOpen] = useState(false);
  // Bumped on each click; used as the icon's key so the swing replays every time.
  const [rings, setRings] = useState(0);
  const [lastPathname, setLastPathname] = useState(pathname);
  const rootRef = useRef<HTMLDivElement>(null);
  const lastFetch = useRef(0);

  const refresh = useCallback((force = false) => {
    if (!force && Date.now() - lastFetch.current < MIN_REFRESH_GAP_MS) return;
    lastFetch.current = Date.now();
    void fetchNotifications().then((next) => {
      if (next) setData(next);
    });
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh(true);
    };
    const onAnnounce = () => refresh(true);
    const timer = window.setInterval(onVisible, POLL_MS);
    window.addEventListener("notifications:refresh", onAnnounce);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("notifications:refresh", onAnnounce);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // Close the popover after navigating (state adjusted during render, not in an effect).
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setOpen(false);
  }

  // Re-check after navigation (the page just visited may have cleared one).
  useEffect(() => {
    refresh();
  }, [pathname, refresh]);

  // Once per browser session, open by itself if there are pending tasks. The
  // "seen" flag is written only when it actually opens, so a re-run of this
  // effect (React strict mode in dev) can't swallow the one opening.
  const taskCount = data.items.filter((i) => i.kind === "task").length;
  useEffect(() => {
    if (taskCount === 0) return;
    try {
      if (sessionStorage.getItem(AUTO_OPEN_KEY) === "1") return;
    } catch {
      // Storage blocked: just show it.
    }
    const t = window.setTimeout(() => {
      try {
        sessionStorage.setItem(AUTO_OPEN_KEY, "1");
      } catch {
        // ignore
      }
      setOpen(true);
    }, 600);
    return () => window.clearTimeout(t);
  }, [taskCount]);

  useEffect(() => {
    if (!open) return;
    refresh(true);
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
  const audits = data.items.filter((i) => i.kind === "audit");
  const messages = data.items.filter((i) => i.kind === "feedback" || i.kind === "reply");
  const tasks = data.items.filter((i) => i.kind === "task");
  const hiddenTasks = Math.max(0, data.count - audits.length - messages.length - tasks.length);

  const renderItem = (n: Item) => (
    <li key={n.id}>
      <Link
        href={n.href}
        role="menuitem"
        onClick={() => setOpen(false)}
        className="flex gap-3 px-4 py-3 transition-colors hover:bg-neutral-50"
      >
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-neutral-900">{n.title}</span>
            {n.urgent && (
              <span className="shrink-0 rounded-full bg-red-600 px-1.5 py-0.5 text-[9px] font-bold text-white">Reminder due</span>
            )}
          </span>
          <span className="block truncate text-xs text-neutral-500">{n.detail}</span>
        </span>
        {n.kind === "audit" ? null : n.kind === "task" && n.ageDays != null ? (
          <span
            className={`h-fit shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${ageBadgeClass(n.ageDays)}`}
          >
            {n.ageDays === 0 ? "today" : `${n.ageDays}d`}
          </span>
        ) : (
          <span className="shrink-0 text-[11px] text-neutral-500">{timeAgo(n.at)}</span>
        )}
      </Link>
    </li>
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setRings((n) => n + 1);
          setOpen((o) => !o);
        }}
        aria-label={data.count > 0 ? `Notifications, ${data.count} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
          open ? "bg-[var(--surface)] text-neutral-900 shadow-sm" : "text-neutral-600 hover:bg-[var(--surface)] hover:text-neutral-900 hover:shadow-sm"
        }`}
      >
        <svg key={rings} width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={rings > 0 ? "bell-ring" : undefined}>
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
            className="badge-pop absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[11px] leading-none font-semibold text-white ring-2 ring-[var(--surface)]"
          >
            {label}
          </span>
        )}
      </button>

      <div
        role="menu"
        aria-label="Notifications"
        inert={!open}
        className={`theme-follow absolute right-0 z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] origin-top-right overflow-hidden rounded-xl border border-neutral-200 bg-white text-neutral-900 shadow-xl shadow-black/20 transition duration-200 ease-out motion-reduce:transition-none ${
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
          <div className="max-h-[60vh] overflow-y-auto">
            {audits.length > 0 && (
              <section>
                <p className="bg-neutral-50 px-4 py-1.5 text-[11px] font-semibold tracking-wider text-neutral-500 uppercase">Upcoming audit</p>
                <ul className="divide-y divide-neutral-100">{audits.map(renderItem)}</ul>
              </section>
            )}
            {messages.length > 0 && (
              <section>
                <p className="bg-neutral-50 px-4 py-1.5 text-[11px] font-semibold tracking-wider text-neutral-500 uppercase">Feedback</p>
                <ul className="divide-y divide-neutral-100">{messages.map(renderItem)}</ul>
              </section>
            )}
            {tasks.length > 0 && (
              <section>
                <p className="bg-neutral-50 px-4 py-1.5 text-[11px] font-semibold tracking-wider text-neutral-500 uppercase">
                  Pending tasks
                </p>
                <ul className="divide-y divide-neutral-100">{tasks.map(renderItem)}</ul>
                {hiddenTasks > 0 && <p className="px-4 py-2 text-xs text-neutral-500">+{hiddenTasks} more - see all tasks</p>}
              </section>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 divide-x divide-neutral-100 border-t border-neutral-100">
          <Link
            href={tasksHref}
            onClick={() => setOpen(false)}
            className="px-4 py-2.5 text-center text-sm font-medium text-brand transition-colors hover:bg-neutral-50"
          >
            All tasks
          </Link>
          <Link
            href={feedbackHref}
            onClick={() => setOpen(false)}
            className="px-4 py-2.5 text-center text-sm font-medium text-brand transition-colors hover:bg-neutral-50"
          >
            {feedbackLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}
