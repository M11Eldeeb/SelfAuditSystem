import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CurrentUser } from "@/lib/auth";
import { getTasks } from "@/lib/tasks";
import { createAdminClient } from "@/lib/supabase/admin";
import { auditDays } from "@/lib/ia-schedule-days";

export type NotificationItem = {
  id: string;
  kind: "feedback" | "reply" | "audit" | "task";
  title: string;
  detail: string;
  href: string;
  at: string;
  /** Tasks only: days pending. */
  ageDays?: number;
  /** Tasks only: an officer's follow-up reminder is due. */
  urgent?: boolean;
};

export type Notifications = { count: number; items: NotificationItem[] };

const EMPTY: Notifications = { count: 0, items: [] };
const MAX_FEEDBACK_ITEMS = 8;
const MAX_TASK_ITEMS = 15;

/**
 * What the bell shows.
 *  - Feedback: officers see messages nobody has opened yet; branch admins see
 *    unread replies to their own feedback.
 *  - Branch admins also see an internal audit that is coming to their branch.
 *  - Tasks (includeTasks): the pending tasks the old floating "Tasks" pill
 *    listed - a branch admin's own, and for officers their own plus branch
 *    tasks that need a reminder today.
 * Tasks cost many queries, so the layouts render without them and the bell
 * fetches the full set from /api/notifications right after load - a slow task
 * lookup can never hold up (or break) a page.
 * RLS scopes every query to what the signed-in user may see.
 */
export async function getNotifications(
  user: CurrentUser,
  { includeTasks = false }: { includeTasks?: boolean } = {}
): Promise<Notifications> {
  // A service manager sees what the branch's warranty admin sees.
  if (user.role === "service_manager") user = { ...user, role: "branch_admin", viewOnly: true };
  if (user.role !== "officer" && user.role !== "branch_admin") return EMPTY;

  const [feedback, tasks, planned] = await Promise.all([
    user.role === "officer" ? getOfficerFeedback() : getBranchAdminMessages(),
    includeTasks ? getTaskItems(user) : Promise.resolve(EMPTY),
    user.role === "branch_admin" ? getScheduledAuditItems(user.branch_id) : Promise.resolve([]),
  ]);

  return { count: planned.length + feedback.count + tasks.count, items: [...planned, ...feedback.items, ...tasks.items] };
}

async function getTaskItems(user: CurrentUser): Promise<Notifications> {
  try {
    const supabase = await createClient();
    const { tasks } = await getTasks(supabase, user);
    const isOfficer = user.role === "officer";
    const relevant = (isOfficer ? tasks.filter((t) => t.owner === "officer" || t.reminder?.due) : tasks).sort(
      (a, b) => b.ageDays - a.ageDays
    );
    return {
      count: relevant.length,
      items: relevant.slice(0, MAX_TASK_ITEMS).map((t) => ({
        id: `task:${t.key}`,
        kind: "task" as const,
        title: t.title,
        detail: `${t.branchName && isOfficer ? `${t.branchName} · ` : ""}${t.detail}`,
        href: t.href,
        at: t.startedAt,
        ageDays: t.ageDays,
        urgent: !!t.reminder?.due,
      })),
    };
  } catch {
    // A slow or failed task lookup must never break the bell.
    return EMPTY;
  }
}

async function getOfficerFeedback(): Promise<Notifications> {
  const supabase = await createClient();
  const [{ count }, { data: rows }] = await Promise.all([
    supabase.from("self_audit_feedback").select("id", { count: "exact", head: true }).is("officer_seen_at", null),
    supabase
      .from("self_audit_feedback")
      .select("id, subject, sender_id, branch_id, created_at")
      .is("officer_seen_at", null)
      .order("created_at", { ascending: false })
      .limit(MAX_FEEDBACK_ITEMS),
  ]);
  if (!rows || rows.length === 0) return { count: count ?? 0, items: [] };

  const senderIds = [...new Set(rows.map((r) => r.sender_id))];
  const branchIds = [...new Set(rows.flatMap((r) => (r.branch_id ? [r.branch_id] : [])))];
  const [{ data: senders }, { data: branches }] = await Promise.all([
    supabase.from("self_audit_users").select("id, full_name, email").in("id", senderIds),
    branchIds.length ? supabase.from("self_audit_branches").select("id, name").in("id", branchIds) : Promise.resolve({ data: [] }),
  ]);
  const senderName = new Map((senders ?? []).map((u) => [u.id, u.full_name?.trim() || u.email]));
  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));

  return {
    count: count ?? rows.length,
    items: rows.map((r) => ({
      id: `feedback:${r.id}`,
      kind: "feedback" as const,
      title: r.subject,
      detail: `${senderName.get(r.sender_id) ?? "Branch admin"}${r.branch_id ? ` · ${branchName.get(r.branch_id) ?? ""}` : ""}`,
      href: `/admin/feedbacks/${r.id}`,
      at: r.created_at,
    })),
  };
}

async function getBranchAdminMessages(): Promise<Notifications> {
  const [replies, audits] = await Promise.all([getBranchAdminReplies(), getUpcomingAuditItems()]);
  return { count: replies.count + audits.count, items: [...audits.items, ...replies.items] };
}

/**
 * From the first day of the month an internal audit is planned in (Internal Audit Schedule) until its last day: the
 * branch admin (and service manager) see it in the bell.
 */
async function getScheduledAuditItems(branchId: string | null): Promise<NotificationItem[]> {
  if (!branchId) return [];
  try {
    const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
    const monthStart = `${today.slice(0, 7)}-01`;
    const nextMonth = new Date(`${monthStart}T00:00:00Z`);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const admin = createAdminClient();
    const [{ data: slots }, { data: holidays }] = await Promise.all([
      admin.from("self_audit_ia_schedule").select("id, slot, planned_date, days").eq("branch_id", branchId).gte("planned_date", monthStart).lt("planned_date", nextMonth.toISOString().slice(0, 10)),
      admin.from("self_audit_holidays").select("day").gte("day", monthStart),
    ]);
    const holidaySet = new Set((holidays ?? []).map((h) => h.day));
    const label = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
    return (slots ?? []).flatMap((s) => {
      const range = auditDays(s.planned_date!, s.days, holidaySet);
      const end = range[range.length - 1];
      if (end < today) return [];
      return [
        {
          id: `audit-plan:${s.id}`,
          kind: "audit" as const,
          title: "Internal audit this month",
          detail: `${label(range[0])}${range.length > 1 ? ` – ${label(end)}` : ""} · ${range.length} working day${range.length === 1 ? "" : "s"}`,
          href: "/audit/audit-schedule",
          at: `${monthStart}T06:00:00Z`,
        },
      ];
    });
  } catch {
    return [];
  }
}

async function getUpcomingAuditItems(): Promise<Notifications> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_upcoming_internal_audits");
  const items: NotificationItem[] = (data ?? []).map((a) => ({
    id: `audit:${a.id}`,
    kind: "audit" as const,
    title: "Internal audit coming to your branch",
    detail: a.audit_date
      ? `${new Date(`${a.audit_date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })} · ${Number(a.claim_count)} claims - download the list`
      : `Date to be confirmed · ${Number(a.claim_count)} claims`,
    href: "/audit",
    at: new Date().toISOString(),
  }));
  return { count: items.length, items };
}

async function getBranchAdminReplies(): Promise<Notifications> {
  const supabase = await createClient();
  const [{ count }, { data: replies }] = await Promise.all([
    supabase.from("self_audit_feedback_replies").select("id", { count: "exact", head: true }).is("sender_seen_at", null),
    supabase
      .from("self_audit_feedback_replies")
      .select("id, feedback_id, created_at")
      .is("sender_seen_at", null)
      .order("created_at", { ascending: false })
      .limit(MAX_FEEDBACK_ITEMS),
  ]);
  if (!replies || replies.length === 0) return { count: count ?? 0, items: [] };

  const feedbackIds = [...new Set(replies.map((r) => r.feedback_id))];
  const { data: feedback } = await supabase.from("self_audit_feedback").select("id, subject").in("id", feedbackIds);
  const subjectById = new Map((feedback ?? []).map((f) => [f.id, f.subject]));

  return {
    count: count ?? replies.length,
    items: replies.map((r) => ({
      id: `reply:${r.id}`,
      kind: "reply" as const,
      title: subjectById.get(r.feedback_id) ?? "Your feedback",
      detail: "The warranty team replied",
      href: `/audit/feedback/${r.feedback_id}`,
      at: r.created_at,
    })),
  };
}
