"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Task } from "@/lib/tasks";
import { TaskRow } from "./task-list";

const SEEN_KEY = "pending-tasks-popup-seen";

/**
 * Pops the viewer's pending tasks up once per browser session (i.e. when
 * they open the site), with a Start button on each; a floating bell keeps
 * the count visible and reopens the list.
 */
export function TaskNotifier({ tasks, isOfficer, tasksHref }: { tasks: Task[]; isOfficer: boolean; tasksHref: string }) {
  // Officers: their own tasks plus branch tasks that need a reminder.
  const relevant = isOfficer ? tasks.filter((t) => t.owner === "officer" || t.reminder?.due) : tasks;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!relevant.length) return;
    let seen = false;
    try {
      seen = sessionStorage.getItem(SEEN_KEY) === "1";
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Storage blocked - just show it.
    }
    if (!seen) {
      const t = setTimeout(() => setOpen(true), 400);
      return () => clearTimeout(t);
    }
  }, [relevant.length]);

  if (!relevant.length) return null;
  const reminders = relevant.filter((t) => t.reminder?.due).length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-5 bottom-5 z-40 flex items-center gap-2 rounded-full bg-[#0b1c30] px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-brand print:hidden"
        aria-label={`${relevant.length} pending tasks`}
      >
        <span aria-hidden="true">🔔</span>
        Tasks
        <span className="rounded-full bg-brand px-2 py-0.5 text-xs">{relevant.length}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-20 print:hidden" onClick={() => setOpen(false)}>
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-neutral-100 bg-gradient-to-r from-brand to-brand-dark px-5 py-4 text-white">
              <div>
                <div className="text-lg font-bold">You have {relevant.length} pending task{relevant.length === 1 ? "" : "s"}</div>
                <div className="text-sm text-white/85">
                  {isOfficer && reminders > 0 ? `${reminders} branch task(s) need a reminder today · ` : ""}Oldest first - press Start to open it.
                </div>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-2 text-xl leading-none text-white/80 hover:text-white" aria-label="Close">
                ×
              </button>
            </div>
            <div className="max-h-[55vh] divide-y divide-neutral-100 overflow-y-auto p-2">
              {relevant.slice(0, 12).map((t) => (
                <div key={t.key} onClick={() => setOpen(false)}>
                  <TaskRow task={t} />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-neutral-100 px-5 py-3">
              <span className="text-xs text-neutral-500">{relevant.length > 12 ? `+${relevant.length - 12} more` : ""}</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100">
                  Later
                </button>
                <Link
                  href={tasksHref}
                  onClick={() => setOpen(false)}
                  className="rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-semibold text-white hover:bg-neutral-700"
                >
                  {isOfficer ? "Open task tracking" : "See all tasks"}
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
