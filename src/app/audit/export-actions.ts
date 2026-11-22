"use server";

import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ASSIGNMENT_STATUS_LABELS } from "@/lib/status-labels";

export type AuditClaimExportRow = {
  claimNumber: string;
  workOrder: string;
  vin: string;
  model: string;
  mileage: number | null;
  creationDate: string;
  dealerSubmitDate: string;
  repairEndDate: string;
  verificationDate: string;
  laborCode: string;
  mainPart: string;
  parts: string;
  claimAmount: number | null;
  priorApproval: string;
  returnTimes: number | null;
  returnTimesDealer: number | null;
  partSerial: string;
  partProductionDate: string;
  auditStatus: string;
};

/**
 * The branch admin's claims of one self-audit cycle (the claims picked for his branch) for an Excel download: what is known about each
 * claim from the claims batch, and where its self audit stands. Read only; the branch's own claims only (the database enforces the same).
 */
export async function exportCycleClaims(cycleId: string): Promise<{ rows?: AuditClaimExportRow[]; cycle?: string; error?: string }> {
  const user = await requireViewer("branch_admin");
  if (!/^[0-9a-f-]{36}$/i.test(cycleId) || !user.branch_id) return { error: "This audit cycle was not found." };
  const supabase = await createClient();
  const [{ data: cycle }, { data: assignments }] = await Promise.all([
    supabase.from("self_audit_audit_cycles").select("cycle_month").eq("id", cycleId).maybeSingle(),
    supabase.from("self_audit_audit_assignments").select("claim_id, status").eq("cycle_id", cycleId).eq("branch_id", user.branch_id),
  ]);
  if (!cycle || !assignments?.length) return { error: "This audit cycle has no claims for your branch." };

  const ids = assignments.map((a) => a.claim_id);
  const [{ data: claims }, { data: parts }] = await Promise.all([
    supabase
      .from("self_audit_claims")
      .select("id, claim_number, work_order_no, vin, vehicle_model, mileage, creation_date, dealer_submit_date, repair_end_date, verification_date, labor_code, main_part_name, claim_amount, prior_approval, return_times, return_times_dealer, part_serial_number, part_production_date")
      .in("id", ids),
    supabase.from("self_audit_claim_parts").select("claim_id, part_no, part_name, quantity").in("claim_id", ids),
  ]);
  const claimById = new Map((claims ?? []).map((c) => [c.id, c]));
  const partsOf = new Map<string, string[]>();
  for (const p of parts ?? []) {
    const line = `${p.part_no ?? ""}${p.part_name ? ` ${p.part_name}` : ""}${p.quantity && Number(p.quantity) !== 1 ? ` x${p.quantity}` : ""}`.trim();
    if (line) partsOf.set(p.claim_id, [...(partsOf.get(p.claim_id) ?? []), line]);
  }

  const text = (v: unknown) => (v == null ? "" : String(v));
  const num = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
  const rows = assignments
    .map((a): AuditClaimExportRow => {
      const c = claimById.get(a.claim_id);
      return {
        claimNumber: text(c?.claim_number),
        workOrder: text(c?.work_order_no),
        vin: text(c?.vin),
        model: text(c?.vehicle_model),
        mileage: num(c?.mileage),
        creationDate: text(c?.creation_date),
        dealerSubmitDate: text(c?.dealer_submit_date),
        repairEndDate: text(c?.repair_end_date),
        verificationDate: text(c?.verification_date),
        laborCode: text(c?.labor_code),
        mainPart: text(c?.main_part_name),
        parts: (partsOf.get(a.claim_id) ?? []).join("; "),
        claimAmount: num(c?.claim_amount),
        priorApproval: text(c?.prior_approval),
        returnTimes: num(c?.return_times),
        returnTimesDealer: num(c?.return_times_dealer),
        partSerial: text(c?.part_serial_number),
        partProductionDate: text(c?.part_production_date),
        auditStatus: ASSIGNMENT_STATUS_LABELS[a.status] ?? text(a.status),
      };
    })
    .sort((x, y) => x.claimNumber.localeCompare(y.claimNumber));
  return { rows, cycle: cycle.cycle_month.slice(0, 7) };
}
