import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { CurrentUser } from "@/lib/auth";
import { RECON_FROM_ORDER, settlementDate } from "@/lib/dashboard/recon-constants";
import { requestLabel } from "@/lib/part-returns";

type Client = SupabaseClient<Database>;

/** A branch task becomes a follow-up once this old, then every REMINDER_EVERY_DAYS. */
export const FOLLOW_UP_AFTER_DAYS = 5;
export const REMINDER_EVERY_DAYS = 2;

export type TaskKind =
  | "self_audit"
  | "branch_ops"
  | "scrap_evidence"
  | "part_return"
  | "reconciliation"
  | "part_return_close"
  | "deductions"
  | "review"
  | "evidence_approval";

export type Task = {
  key: string;
  kind: TaskKind;
  /** Who has to act: the branch, or the officer. */
  owner: "branch" | "officer";
  branchId: string | null;
  branchName: string | null;
  title: string;
  detail: string;
  /** Where "Start" takes the viewer. */
  href: string;
  startedAt: string;
  ageDays: number;
  dueAt: string | null;
  /** Officer view of branch tasks only. */
  reminder?: { due: boolean; lastSentAt: string | null; count: number };
};

export type TaskData = {
  tasks: Task[];
  /** Officer only: branch admin emails per branch, for reminder drafts. */
  branchEmails: Record<string, string[]>;
};

const DAY = 86_400_000;
const ageOf = (iso: string) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / DAY));

/**
 * Every pending task for the viewer. Branch admins: their own branch's
 * self audit, branch operations, scrap evidence and part returns. Officers:
 * the same branch tasks for every branch (for follow-up, with reminder
 * status) plus their own - reconciliation, part returns to receive,
 * deductions, reviews and evidence approvals. Reads on the viewer's RLS.
 */
export async function getTasks(supabase: Client, user: CurrentUser): Promise<TaskData> {
  const isOfficer = user.role === "officer";
  if (!isOfficer && user.role !== "branch_admin") return { tasks: [], branchEmails: {} };

  const [{ data: branches }, { data: cycles }, { data: wrCycles }, { data: lastGen }] = await Promise.all([
    supabase.from("self_audit_branches").select("id, name, active"),
    supabase.from("self_audit_audit_cycles").select("id, cycle_month, created_at, deadline_at").eq("status", "open"),
    supabase.from("self_audit_warranty_room_cycles").select("id, cycle_month, created_at").eq("status", "open"),
    supabase.from("self_audit_scrap_generations").select("finished_at").eq("status", "done").order("finished_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const scopeBranches = (branches ?? []).filter((b) => (isOfficer ? b.active : b.id === user.branch_id));
  const scopeIds = scopeBranches.map((b) => b.id);
  const cycleIds = (cycles ?? []).map((c) => c.id);
  const wrCycle = [...(wrCycles ?? [])].sort((a, b) => b.cycle_month.localeCompare(a.cycle_month))[0];

  const [{ data: assignments }, { data: ops }, { data: evidence }, { data: partReturns }, flaggedCounts] = await Promise.all([
    cycleIds.length
      ? supabase.from("self_audit_audit_assignments").select("id, cycle_id, branch_id, status").in("cycle_id", cycleIds).in("branch_id", scopeIds)
      : Promise.resolve({ data: [] as { id: string; cycle_id: string; branch_id: string; status: string }[] }),
    cycleIds.length
      ? supabase.from("self_audit_branch_operation_progress").select("cycle_id, branch_id, status").in("cycle_id", cycleIds).in("branch_id", scopeIds)
      : Promise.resolve({ data: [] as { cycle_id: string; branch_id: string; status: string }[] }),
    wrCycle
      ? supabase.from("self_audit_destroy_evidence").select("branch_id, status, submitted_at").eq("cycle_id", wrCycle.id).in("branch_id", scopeIds)
      : Promise.resolve({ data: [] as { branch_id: string; status: string; submitted_at: string | null }[] }),
    supabase.from("self_audit_part_returns").select("id, request_no, branch_id, status, created_at, branch_closed_at").in("status", ["open", "dispatched"]).in("branch_id", scopeIds),
    // Scrap evidence is only owed by a branch with parts flagged to scrap.
    Promise.all(
      scopeIds.map(async (id) => {
        const { count } = await supabase
          .from("self_audit_scrap_requests")
          .select("id", { count: "exact", head: true })
          .eq("branch_id", id)
          .eq("status", "pending");
        return [id, count ?? 0] as const;
      })
    ),
  ]);
  const flagged = new Map(flaggedCounts);

  const tasks: Task[] = [];
  const add = (t: Omit<Task, "ageDays">) => tasks.push({ ...t, ageDays: ageOf(t.startedAt) });
  const monthName = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  for (const cycle of cycles ?? []) {
    for (const b of scopeBranches) {
      const mine = (assignments ?? []).filter((a) => a.cycle_id === cycle.id && a.branch_id === b.id);
      const pending = mine.filter((a) => a.status === "not_started" || a.status === "in_progress");
      if (pending.length) {
        add({
          key: `self_audit:${cycle.id}:${b.id}`,
          kind: "self_audit",
          owner: "branch",
          branchId: b.id,
          branchName: b.name,
          title: `Self audit - ${monthName(cycle.cycle_month)}`,
          detail: `${pending.length} of ${mine.length} claims not submitted`,
          href: isOfficer ? `/admin/review/${cycle.id}/${b.id}` : `/audit/${pending[0].id}`,
          startedAt: cycle.created_at,
          dueAt: cycle.deadline_at,
        });
      }
      const awaitingReview = mine.filter((a) => a.status === "submitted" || a.status === "ai_checked");
      if (isOfficer && awaitingReview.length) {
        add({
          key: `review:${cycle.id}:${b.id}`,
          kind: "review",
          owner: "officer",
          branchId: b.id,
          branchName: b.name,
          title: `Review self audit - ${monthName(cycle.cycle_month)}`,
          detail: `${awaitingReview.length} submitted claims waiting for your review`,
          href: `/admin/review/${cycle.id}/${b.id}`,
          startedAt: cycle.created_at,
          dueAt: null,
        });
      }
      if (mine.length) {
        const progress = (ops ?? []).find((o) => o.cycle_id === cycle.id && o.branch_id === b.id);
        if (!progress || progress.status === "not_started") {
          add({
            key: `branch_ops:${cycle.id}:${b.id}`,
            kind: "branch_ops",
            owner: "branch",
            branchId: b.id,
            branchName: b.name,
            title: `Branch operations checklist - ${monthName(cycle.cycle_month)}`,
            detail: "Not submitted",
            href: isOfficer ? `/admin/review/${cycle.id}/${b.id}/branch-ops` : `/audit/branch-ops/${cycle.id}`,
            startedAt: cycle.created_at,
            dueAt: cycle.deadline_at,
          });
        } else if (isOfficer && progress.status === "submitted") {
          add({
            key: `review_ops:${cycle.id}:${b.id}`,
            kind: "review",
            owner: "officer",
            branchId: b.id,
            branchName: b.name,
            title: `Review branch operations - ${monthName(cycle.cycle_month)}`,
            detail: "Submitted, waiting for your review",
            href: `/admin/review/${cycle.id}/${b.id}/branch-ops`,
            startedAt: cycle.created_at,
            dueAt: null,
          });
        }
      }
    }
  }

  if (wrCycle) {
    const since = lastGen?.finished_at && lastGen.finished_at > wrCycle.created_at ? lastGen.finished_at : wrCycle.created_at;
    for (const b of scopeBranches) {
      const ev = (evidence ?? []).find((e) => e.branch_id === b.id);
      const n = flagged.get(b.id) ?? 0;
      if (n > 0 && (!ev || ev.status === "pending")) {
        add({
          key: `scrap_evidence:${wrCycle.id}:${b.id}`,
          kind: "scrap_evidence",
          owner: "branch",
          branchId: b.id,
          branchName: b.name,
          title: "Submit scrap (destroy) evidence",
          detail: `${n} claims flagged to scrap - evidence not submitted`,
          href: isOfficer ? `/admin/warranty-room/destroy-evidence/${wrCycle.id}` : "/audit/warranty-room",
          startedAt: since,
          dueAt: null,
        });
      }
      if (isOfficer && ev?.status === "submitted") {
        add({
          key: `evidence_approval:${wrCycle.id}:${b.id}`,
          kind: "evidence_approval",
          owner: "officer",
          branchId: b.id,
          branchName: b.name,
          title: "Approve scrap evidence",
          detail: "Branch submitted destroy evidence",
          href: `/admin/warranty-room/destroy-evidence/${wrCycle.id}`,
          startedAt: ev.submitted_at ?? since,
          dueAt: null,
        });
      }
    }
  }

  for (const r of partReturns ?? []) {
    if (r.status === "open") {
      add({
        key: `part_return:${r.id}`,
        kind: "part_return",
        owner: "branch",
        branchId: r.branch_id,
        branchName: branchName.get(r.branch_id) ?? null,
        title: `Part return ${requestLabel(r.request_no)}`,
        detail: "Parts requested back - ship and enter the waybill",
        href: isOfficer ? `/admin/part-returns/${r.id}` : `/audit/part-returns/${r.id}`,
        startedAt: r.created_at,
        dueAt: null,
      });
    } else if (isOfficer) {
      add({
        key: `part_return_close:${r.id}`,
        kind: "part_return_close",
        owner: "officer",
        branchId: r.branch_id,
        branchName: branchName.get(r.branch_id) ?? null,
        title: `Receive part return ${requestLabel(r.request_no)}`,
        detail: "Dispatched by branch - add invoice, shipping company and waybill to the manufacturer",
        href: `/admin/part-returns/${r.id}`,
        startedAt: r.branch_closed_at ?? r.created_at,
        dueAt: null,
      });
    }
  }

  const branchEmails: Record<string, string[]> = {};
  if (isOfficer) {
    const [{ data: recon }, { data: deductions }, { data: admins }] = await Promise.all([
      supabase.rpc("get_reconciliation_summary", { p_branch_ids: scopeIds, p_from_order: RECON_FROM_ORDER }),
      supabase.from("self_audit_part_return_items").select("id, created_at").eq("deduction_status", "pending"),
      supabase.from("self_audit_users").select("email, branch_id").eq("role", "branch_admin"),
    ]);

    const byOrder = new Map<string, { claims: number; amount: number }>();
    for (const r of recon ?? []) {
      const pending = Number(r.loss_count) - Number(r.reviewed_count);
      if (pending <= 0) continue;
      const o = byOrder.get(r.settlement_order) ?? { claims: 0, amount: 0 };
      o.claims += pending;
      o.amount += Number(r.loss_amount) - Number(r.reviewed_amount);
      byOrder.set(r.settlement_order, o);
    }
    for (const [order, o] of byOrder) {
      const d = order.match(/(\d{4})(\d{2})(\d{2})$/);
      add({
        key: `reconciliation:${order}`,
        kind: "reconciliation",
        owner: "officer",
        branchId: null,
        branchName: null,
        title: `Reconcile settlement ${order}`,
        detail: `${o.claims} claims not reviewed · ${o.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} loss · ${settlementDate(order) ?? ""}`,
        href: "/admin/dashboard?tab=reconciliation",
        startedAt: d ? `${d[1]}-${d[2]}-${d[3]}T00:00:00Z` : new Date().toISOString(),
        dueAt: null,
      });
    }

    if (deductions?.length) {
      const oldest = deductions.map((d) => d.created_at).sort()[0];
      add({
        key: "deductions",
        kind: "deductions",
        owner: "officer",
        branchId: null,
        branchName: null,
        title: "Deduct missing parts",
        detail: `${deductions.length} missing parts waiting for a deduction decision`,
        href: "/admin/part-returns",
        startedAt: oldest,
        dueAt: null,
      });
    }

    for (const a of admins ?? []) if (a.branch_id && a.email) (branchEmails[a.branch_id] ??= []).push(a.email);

    // Follow-up status for branch tasks: due once 5 days old, then every 2
    // days after the last reminder sent.
    const branchTaskKeys = tasks.filter((t) => t.owner === "branch").map((t) => t.key);
    const { data: reminders } = branchTaskKeys.length
      ? await supabase.from("self_audit_task_reminders").select("task_key, sent_at").in("task_key", branchTaskKeys)
      : { data: [] as { task_key: string; sent_at: string }[] };
    for (const t of tasks) {
      if (t.owner !== "branch") continue;
      const sent = (reminders ?? []).filter((r) => r.task_key === t.key).map((r) => r.sent_at).sort();
      const last = sent.at(-1) ?? null;
      const due = t.ageDays >= FOLLOW_UP_AFTER_DAYS && (!last || Date.now() - Date.parse(last) >= REMINDER_EVERY_DAYS * DAY);
      t.reminder = { due, lastSentAt: last, count: sent.length };
    }
  }

  tasks.sort((a, b) => b.ageDays - a.ageDays);
  return { tasks, branchEmails };
}
