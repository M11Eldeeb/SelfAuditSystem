import "server-only";
import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { branchByCode, canUseBranch, requireQueueAccess, type QueueAccess, type QueueBranch } from "@/lib/queue/server";
import { startOfSaudiDay } from "@/lib/queue/core";

/** A branch queue page: the branch from the address and the person's access (sent away if it is not theirs). */
export async function queuePage(code: string, need?: "manager" | "service" | "parts"): Promise<{ a: QueueAccess; branch: QueueBranch }> {
  const a = await requireQueueAccess();
  const branch = await branchByCode(code);
  if (!branch) notFound();
  if (!canUseBranch(a, branch.id)) redirect("/queue");
  if (need === "manager" && a.role !== "manager") redirect(`/queue/${branch.queue_code}`);
  if (need === "service" && a.role === "parts_advisor") redirect(`/queue/${branch.queue_code}/parts`);
  if (need === "parts" && a.role === "advisor") redirect(`/queue/${branch.queue_code}`);
  return { a, branch };
}

export type StatRow = { branch_id: string; status: string; service_mode: string; queue_entry_at: string; served_at: string | null; closed_at: string | null; advisor_name: string | null };

/** Tickets of the last `days` days (Saudi days), of one branch or of all. */
export async function ticketsSince(days: number, branchId?: string): Promise<StatRow[]> {
  const out: StatRow[] = [];
  const admin = createAdminClient();
  for (let from = 0; ; from += 1000) {
    let q = admin
      .from("self_audit_queue_tickets")
      .select("branch_id, status, service_mode, queue_entry_at, served_at, closed_at, advisor_name")
      .gte("queue_entry_at", startOfSaudiDay(days - 1))
      .order("queue_entry_at")
      .range(from, from + 999);
    if (branchId) q = q.eq("branch_id", branchId);
    const { data } = await q;
    out.push(...((data ?? []) as StatRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
