import "server-only";
import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { branchByCode, canUseBranch, requireQueueAccess, type QueueAccess, type QueueBranch } from "@/lib/queue/server";
import { saudiDate, startOfSaudiDay } from "@/lib/queue/core";

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

export type StatRow = {
  branch_id: string;
  status: string;
  service_mode: string;
  queue_entry_at: string;
  served_at: string | null;
  closed_at: string | null;
  advisor_name: string | null;
  /** The appointment this customer came for (joined the queue as it), and its time. */
  appointment_id?: string | null;
  appointment_at?: string | null;
};

/** A booked appointment (DMS sheet or added by hand), for the appointment KPIs. */
export type ApptRow = { id: string; branch_id: string; appt_date: string; appt_time: string | null; service_reception: string | null; source: string };

/** The appointments of the last `days` days up to today (Saudi days), of one branch or of all. */
export async function appointmentsSince(days: number, branchId?: string): Promise<ApptRow[]> {
  const out: ApptRow[] = [];
  const admin = createAdminClient();
  const from = saudiDate(startOfSaudiDay(days - 1));
  const today = saudiDate(startOfSaudiDay(0));
  for (let i = 0; ; i += 1000) {
    let q = admin
      .from("self_audit_queue_appointments")
      .select("id, branch_id, appt_date, appt_time, service_reception, source")
      .gte("appt_date", from)
      .lte("appt_date", today)
      .order("appt_date")
      .range(i, i + 999);
    if (branchId) q = q.eq("branch_id", branchId);
    const { data } = await q;
    out.push(...((data ?? []) as ApptRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Tickets of the last `days` days (Saudi days), of one branch or of all. */
export async function ticketsSince(days: number, branchId?: string): Promise<StatRow[]> {
  const out: StatRow[] = [];
  const admin = createAdminClient();
  for (let from = 0; ; from += 1000) {
    let q = admin
      .from("self_audit_queue_tickets")
      .select("branch_id, status, service_mode, queue_entry_at, served_at, closed_at, advisor_name, appointment_id, appointment_at")
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
