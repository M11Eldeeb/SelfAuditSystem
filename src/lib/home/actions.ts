import "server-only";
import type { CurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getTasks, type TaskKind } from "@/lib/tasks";
import { inquiriesBadge } from "@/lib/technical-inquiries-server";
import { isLate, type InquiryStatus } from "@/lib/technical-inquiries";
import { sameAdvisor } from "@/lib/reception";

/** One line of the Home page's "Needs your action": what waits for this person, how many, and where to do it. */
export type HomeAction = { key: string; label: string; count: number; href: string };

const NONE = "00000000-0000-0000-0000-000000000000";

const TASK_LABEL: Record<TaskKind, string> = {
  self_audit: "Self audits to complete",
  branch_ops: "Branch operations to answer",
  scrap_evidence: "Scrap evidence to upload",
  part_return: "Part returns to send",
  part_return_close: "Part returns to receive",
  reconciliation: "Reconciliation to do",
  deductions: "Deductions to check",
  review: "Audits to review",
  evidence_approval: "Evidence to approve",
};

/** The warranty tasks (lib/tasks.ts) grouped by kind: the officer's own, or the branch admin's branch. */
async function taskActions(user: CurrentUser, tasksHref: string): Promise<HomeAction[]> {
  const { tasks } = await getTasks(await createClient(), user);
  const mine = user.role === "officer" ? tasks.filter((t) => t.owner === "officer") : tasks;
  const groups = new Map<TaskKind, typeof mine>();
  for (const t of mine) groups.set(t.kind, [...(groups.get(t.kind) ?? []), t]);
  return [...groups.entries()].map(([kind, list]) => ({ key: `task:${kind}`, label: TASK_LABEL[kind], count: list.length, href: list.length === 1 ? list[0].href : tasksHref }));
}

async function inquiryAction(user: CurrentUser, href: string, label: string): Promise<HomeAction[]> {
  const badge = await inquiriesBadge(user);
  const count = Number(badge);
  return [{ key: "inquiries", label, count: Number.isFinite(count) ? count : 0, href }];
}

async function lateInquiries(href: string): Promise<HomeAction[]> {
  const { data } = await (await createClient()).from("self_audit_technical_inquiries").select("status, waiting_since").in("status", ["open", "awaiting_workshop"]).limit(5000);
  return [{ key: "late", label: "Inquiries waiting more than 2 days", count: (data ?? []).filter((r) => isLate(r.waiting_since, r.status as InquiryStatus)).length, href }];
}

async function techClaimsToReview(branchId: string | null, href: string): Promise<HomeAction[]> {
  let q = createAdminClient().from("self_audit_tech_claims").select("id", { count: "exact", head: true }).eq("status", "submitted");
  if (branchId) q = q.eq("branch_id", branchId);
  const { count } = await q;
  return [{ key: "tech-review", label: "Technician claims to review", count: count ?? 0, href }];
}

async function technicianActions(user: CurrentUser): Promise<HomeAction[]> {
  const { data } = await createAdminClient().from("self_audit_tech_claims").select("status").eq("technician_id", user.id).in("status", ["returned", "uploading"]).limit(1000);
  const rows = data ?? [];
  return [
    { key: "returned", label: "Claims returned to fix", count: rows.filter((r) => r.status === "returned").length, href: "/technician" },
    { key: "uploading", label: "Claims not submitted yet", count: rows.filter((r) => r.status === "uploading").length, href: "/technician" },
  ];
}

async function complaintActions(user: CurrentUser, href: string, onlyMine: boolean): Promise<HomeAction[]> {
  const { data } = await createAdminClient().from("self_audit_complaints").select("service_advisor").eq("branch_id", user.branch_id ?? NONE).is("resolved_on", null).limit(5000);
  const rows = (data ?? []).filter((r) => !onlyMine || sameAdvisor(r.service_advisor, user));
  return [{ key: "complaints", label: onlyMine ? "Open complaints in my name" : "Open complaints in my branch", count: rows.length, href }];
}

async function qcActions(user: CurrentUser): Promise<HomeAction[]> {
  const { count } = await createAdminClient().from("self_audit_qc_checks").select("id", { count: "exact", head: true }).eq("controller_id", user.id).eq("status", "failed");
  return [{ key: "qc-failed", label: "Failed checks to follow up", count: count ?? 0, href: "/qc" }];
}

async function queueActions(user: CurrentUser): Promise<HomeAction[]> {
  const today = `${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date())}T00:00:00+03:00`;
  const { count } = await createAdminClient().from("self_audit_queue_tickets").select("id", { count: "exact", head: true }).eq("branch_id", user.branch_id ?? NONE).eq("status", "waiting").gte("created_at", today);
  return [{ key: "queue-waiting", label: "Customers waiting now", count: count ?? 0, href: "/queue" }];
}

/** What waits for this person, by role (a source that fails is left out, never the page). Items with nothing waiting are kept, shown quieter. */
export async function homeActionsFor(user: CurrentUser, area: string): Promise<HomeAction[]> {
  const all = async (...parts: Promise<HomeAction[]>[]) => (await Promise.all(parts.map((p) => p.catch(() => [] as HomeAction[])))).flat();

  if (area === "technician") return all(technicianActions(user));
  if (area === "technical") return all(inquiryAction(user, "/technical/technical-inquiries", "Open inquiries to answer"), lateInquiries("/technical/technical-inquiries"));
  if (area === "workshop") return all(inquiryAction(user, "/workshop/technical-inquiries", "Inquiries waiting for the workshop"));
  if (area === "reviewer") return all(techClaimsToReview(user.branch_id ?? NONE, "/reviewer/technician-claims"));
  if (area === "qc") return all(qcActions(user));
  if (area === "queue") return all(queueActions(user));
  if (area === "advisor") return all(complaintActions(user, "/advisor/complaints", true));
  if (area === "analyst") return [];
  if (area === "audit") {
    if (user.managerKind === "service_manager") return all(complaintActions(user, "/audit/complaints", false));
    return all(taskActions(user, "/audit/tasks"), techClaimsToReview(user.branch_id ?? NONE, "/audit/technician-claims"));
  }
  if (user.managerKind) return [];
  return all(taskActions(user, "/admin/tasks"), inquiryAction(user, "/admin/technical-inquiries", "Technical inquiries open"));
}
