import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CurrentUser } from "@/lib/auth";

export type NotificationItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
  at: string;
};

export type Notifications = { count: number; items: NotificationItem[] };

const EMPTY: Notifications = { count: 0, items: [] };
const MAX_ITEMS = 8;

/**
 * What the bell shows. Officers: feedback nobody on the team has opened yet.
 * Branch admins: replies to their own feedback they have not opened yet.
 * RLS already scopes both queries to what the signed-in user may see.
 */
export async function getNotifications(user: CurrentUser): Promise<Notifications> {
  if (user.role === "officer") return getOfficerNotifications();
  if (user.role === "branch_admin") return getBranchAdminNotifications();
  return EMPTY;
}

async function getOfficerNotifications(): Promise<Notifications> {
  const supabase = await createClient();
  const [{ count }, { data: rows }] = await Promise.all([
    supabase.from("self_audit_feedback").select("id", { count: "exact", head: true }).is("officer_seen_at", null),
    supabase
      .from("self_audit_feedback")
      .select("id, subject, sender_id, branch_id, created_at")
      .is("officer_seen_at", null)
      .order("created_at", { ascending: false })
      .limit(MAX_ITEMS),
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
      id: r.id,
      title: r.subject,
      detail: `${senderName.get(r.sender_id) ?? "Branch admin"}${r.branch_id ? ` · ${branchName.get(r.branch_id) ?? ""}` : ""}`,
      href: `/admin/feedbacks/${r.id}`,
      at: r.created_at,
    })),
  };
}

async function getBranchAdminNotifications(): Promise<Notifications> {
  const supabase = await createClient();
  const [{ count }, { data: replies }] = await Promise.all([
    supabase.from("self_audit_feedback_replies").select("id", { count: "exact", head: true }).is("sender_seen_at", null),
    supabase
      .from("self_audit_feedback_replies")
      .select("id, feedback_id, created_at")
      .is("sender_seen_at", null)
      .order("created_at", { ascending: false })
      .limit(MAX_ITEMS),
  ]);
  if (!replies || replies.length === 0) return { count: count ?? 0, items: [] };

  const feedbackIds = [...new Set(replies.map((r) => r.feedback_id))];
  const { data: feedback } = await supabase.from("self_audit_feedback").select("id, subject").in("id", feedbackIds);
  const subjectById = new Map((feedback ?? []).map((f) => [f.id, f.subject]));

  return {
    count: count ?? replies.length,
    items: replies.map((r) => ({
      id: r.id,
      title: subjectById.get(r.feedback_id) ?? "Your feedback",
      detail: "The warranty team replied",
      href: `/audit/feedback/${r.feedback_id}`,
      at: r.created_at,
    })),
  };
}
