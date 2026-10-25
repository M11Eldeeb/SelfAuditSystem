"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Task, TaskData } from "@/lib/tasks";
import { logTaskReminders } from "@/app/actions/task-reminders";
import { sendDirectMail } from "@/app/actions/direct-mail";

const FOLLOW_UP_AFTER_DAYS = 5;

const KIND_ICON: Record<Task["kind"], string> = {
  self_audit: "📋",
  branch_ops: "🏢",
  scrap_evidence: "🗑️",
  part_return: "📦",
  reconciliation: "💰",
  part_return_close: "🚚",
  deductions: "➖",
  review: "🔍",
  evidence_approval: "✅",
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Riyadh" }) : null;

export function AgeBadge({ days }: { days: number }) {
  const cls = days >= FOLLOW_UP_AFTER_DAYS ? "bg-red-50 text-red-700 ring-red-600/20" : days >= 3 ? "bg-amber-50 text-amber-700 ring-amber-600/20" : "bg-neutral-50 text-neutral-600 ring-neutral-500/20";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ring-1 ring-inset ${cls}`}>{days === 0 ? "today" : `${days}d`}</span>;
}

export function TaskRow({ task, compact = false }: { task: Task; compact?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-neutral-50">
      <span className="text-lg" aria-hidden="true">
        {KIND_ICON[task.kind]}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-neutral-900">{task.title}</span>
          {task.branchName && !compact && <span className="text-xs text-neutral-500">· {task.branchName}</span>}
          <AgeBadge days={task.ageDays} />
          {task.reminder?.due && <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white">Reminder due</span>}
        </div>
        <div className="truncate text-xs text-neutral-600">
          {task.detail}
          {task.dueAt && <> · due {fmtDate(task.dueAt)}</>}
          {task.reminder && task.reminder.count > 0 && <> · reminded {task.reminder.count}× (last {fmtDate(task.reminder.lastSentAt)})</>}
        </div>
      </div>
      <Link
        href={task.href}
        className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-dark"
      >
        {task.owner === "branch" && task.reminder ? "Open" : "Start"} →
      </Link>
    </div>
  );
}

/** Ready-to-send reminder email to a branch's admins for its overdue tasks. */
function ReminderButton({ branchId, branchName, tasks, emails }: { branchId: string; branchName: string; tasks: Task[]; emails: string[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const overdue = tasks.filter((t) => t.ageDays >= FOLLOW_UP_AFTER_DAYS);
  if (!overdue.length) return null;
  const due = overdue.some((t) => t.reminder?.due);

  const send = () => {
    const origin = window.location.origin;
    const subject = `Reminder: pending warranty tasks - ${branchName}`;
    const body = [
      `Dear ${branchName} team,`,
      "",
      "The following warranty tasks are still pending. Please complete them as soon as possible:",
      "",
      ...overdue.map((t) => `- ${t.title}: ${t.detail} (pending ${t.ageDays} days)${t.dueAt ? `, due ${fmtDate(t.dueAt)}` : ""}`),
      "",
      `Open the system: ${origin}/audit`,
      "",
      "Thank you,",
      "Warranty team",
    ].join("\n");
    startTransition(async () => {
      const res = await sendDirectMail({ kind: "task-reminder", to: emails, subject, text: body });
      if (res.error) {
        setMsg({ ok: false, text: res.error });
        return;
      }
      await logTaskReminders(
        branchId,
        overdue.map((t) => t.key)
      );
      setMsg({ ok: true, text: `Sent to ${emails.join(", ")}` });
      router.refresh();
    });
  };

  return (
    <span className="inline-flex items-center gap-2">
      {msg && <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</span>}
      <button
      type="button"
      onClick={send}
      disabled={isPending || emails.length === 0}
      title={emails.length ? emails.join(", ") : "No branch admin email on file"}
      className={`rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm transition disabled:opacity-50 ${
        due ? "bg-red-600 text-white hover:bg-red-700" : "border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
      }`}
    >
      ✉ {isPending ? "Sending..." : due ? "Send reminder (due)" : "Send reminder"}
      </button>
    </span>
  );
}

type Filter = "all" | "overdue" | "reminder";

/**
 * Full task tracking list. Branch admins see their own tasks; officers see
 * their own first, then every branch's tasks grouped by branch with
 * follow-up status and a reminder email per branch.
 */
export function TaskTracker({ data, isOfficer }: { data: TaskData; isOfficer: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");
  const match = (t: Task) =>
    filter === "all" ? true : filter === "overdue" ? t.ageDays >= FOLLOW_UP_AFTER_DAYS : !!t.reminder?.due;

  const mine = data.tasks.filter((t) => (isOfficer ? t.owner === "officer" : true)).filter(match);
  const branchTasks = useMemo(() => {
    const m = new Map<string, { name: string; tasks: Task[] }>();
    if (!isOfficer) return m;
    for (const t of data.tasks.filter((t) => t.owner === "branch")) {
      const g = m.get(t.branchId!) ?? { name: t.branchName ?? "", tasks: [] };
      g.tasks.push(t);
      m.set(t.branchId!, g);
    }
    return m;
  }, [data.tasks, isOfficer]);

  const overdueCount = data.tasks.filter((t) => (isOfficer ? t.owner === "branch" : true) && t.ageDays >= FOLLOW_UP_AFTER_DAYS).length;
  const reminderCount = data.tasks.filter((t) => t.reminder?.due).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: isOfficer ? "My tasks" : "Pending tasks", value: data.tasks.filter((t) => (isOfficer ? t.owner === "officer" : true)).length, tone: "text-neutral-900" },
          ...(isOfficer ? [{ label: "Branch tasks open", value: data.tasks.filter((t) => t.owner === "branch").length, tone: "text-neutral-900" }] : []),
          { label: `Over ${FOLLOW_UP_AFTER_DAYS} days`, value: overdueCount, tone: overdueCount ? "text-red-700" : "text-neutral-900" },
          ...(isOfficer ? [{ label: "Reminders due", value: reminderCount, tone: reminderCount ? "text-red-700" : "text-neutral-900" }] : []),
        ].map((c) => (
          <div key={c.label} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
            <div className="text-[11px] font-bold tracking-wider text-neutral-500 uppercase">{c.label}</div>
            <div className={`text-2xl font-bold ${c.tone}`}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg bg-white p-1 shadow-sm ring-1 ring-neutral-200/70">
        {(
          [
            ["all", "All"],
            ["overdue", `Over ${FOLLOW_UP_AFTER_DAYS} days`],
            ...(isOfficer ? ([["reminder", "Reminder due"]] as const) : []),
          ] as [Filter, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${filter === k ? "bg-brand text-white" : "text-neutral-600 hover:bg-neutral-100"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <section className="rounded-xl bg-white shadow-sm ring-1 ring-neutral-200/70">
        <h2 className="border-b border-neutral-100 px-4 py-3 font-semibold text-neutral-900">{isOfficer ? "My tasks" : "Your tasks"}</h2>
        <div className="divide-y divide-neutral-100 p-1">
          {mine.length ? mine.map((t) => <TaskRow key={t.key} task={t} />) : <p className="px-3 py-6 text-center text-sm text-neutral-500">Nothing pending. 🎉</p>}
        </div>
      </section>

      {isOfficer && (
        <section className="space-y-3">
          <h2 className="font-semibold text-neutral-900">Branch follow-up</h2>
          <p className="text-sm text-neutral-600">
            Branch tasks open {FOLLOW_UP_AFTER_DAYS}+ days need a reminder, then again every 2 days. “Send reminder” opens a ready email to the branch admins and records it.
          </p>
          {[...branchTasks.entries()]
            .map(([id, g]) => ({ id, ...g, shown: g.tasks.filter(match) }))
            .filter((g) => g.shown.length)
            .sort((a, b) => Math.max(...b.tasks.map((t) => t.ageDays)) - Math.max(...a.tasks.map((t) => t.ageDays)))
            .map((g) => (
              <div key={g.id} className="rounded-xl bg-white shadow-sm ring-1 ring-neutral-200/70">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 px-4 py-2.5">
                  <div className="font-semibold text-neutral-900">
                    {g.name} <span className="text-sm font-normal text-neutral-500">· {g.tasks.length} open</span>
                  </div>
                  <ReminderButton branchId={g.id} branchName={g.name} tasks={g.tasks} emails={data.branchEmails[g.id] ?? []} />
                </div>
                <div className="divide-y divide-neutral-100 p-1">
                  {g.shown.map((t) => (
                    <TaskRow key={t.key} task={t} compact />
                  ))}
                </div>
              </div>
            ))}
          {branchTasks.size === 0 && <p className="text-sm text-neutral-500">No open branch tasks.</p>}
        </section>
      )}
    </div>
  );
}
