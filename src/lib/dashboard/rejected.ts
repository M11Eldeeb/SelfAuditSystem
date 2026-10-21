import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type RejectedEntry = {
  id: string;
  branch: string;
  workOrder: string;
  claimNo: string | null;
  date: string; // rejection date, YYYY-MM-DD
  reason: string;
  advisor: string | null;
  teamLeader: string | null;
  model: string | null;
  labours: string[];
  parts: string[];
  repeat: boolean;
};

/**
 * The Rejected Claims Diary entries of the dashboard's branches for the 12 months up to the end of the selected period
 * (the trend needs the months before it; the breakdowns use the selected months only - done in the browser).
 */
export async function getRejectedClaimsStats(branchIds: string[], to: string): Promise<RejectedEntry[]> {
  if (!branchIds.length) return [];
  const admin = createAdminClient();
  const [y, m] = to.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const start = new Date(Date.UTC(y, m - 12, 1)).toISOString().slice(0, 10);
  const [{ data: rows }, { data: branches }] = await Promise.all([
    admin
      .from("self_audit_rejected_claims")
      .select("id, branch_id, work_order_no, claim_no, rejection_date, reason, service_advisor, team_leader, vehicle_model, labours, parts, duplicate_of")
      .in("branch_id", branchIds)
      .gte("rejection_date", start)
      .lt("rejection_date", end)
      .order("rejection_date", { ascending: false })
      .limit(5000),
    admin.from("self_audit_branches").select("id, name"),
  ]);
  const name = new Map((branches ?? []).map((b) => [b.id, b.name]));
  return (rows ?? []).map((r) => ({
    id: r.id,
    branch: name.get(r.branch_id) ?? "Branch",
    workOrder: r.work_order_no,
    claimNo: r.claim_no,
    date: r.rejection_date.slice(0, 10),
    reason: r.reason.slice(0, 300),
    advisor: r.service_advisor,
    teamLeader: r.team_leader,
    model: r.vehicle_model,
    labours: r.labours ?? [],
    parts: r.parts ?? [],
    repeat: !!r.duplicate_of,
  }));
}
