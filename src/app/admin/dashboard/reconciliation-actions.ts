"use server";

import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ReconciliationRow = {
  claimId: string;
  branchId: string;
  vin: string | null;
  claimNumber: string;
  workOrderNo: string | null;
  claimAmount: number;
  adjustedAmount: number;
  /** Claim TOL. - Adjusted Claim TOL.: what SAIC didn't pay. */
  lossAmount: number;
  firstSubmitDate: string | null;
  laborName: string | null;
  partName: string | null;
  deductionType: "saic" | "internal" | null;
  outcome: "reinvoiced" | "overdue" | null;
  notes: string | null;
  updatedAt: string | null;
};

type Raw = {
  id: string;
  branch_id: string;
  vin: string | null;
  claim_number: string;
  work_order_no: string | null;
  claim_amount: number | null;
  main_part_name: string | null;
  adjusted: string | null;
  first_submit: string | null;
  labor_name: string | null;
};

// Typed as plain string so supabase-js doesn't try to infer a row type from
// the JSON-path select.
const SELECT: string =
  'id, branch_id, vin, claim_number, work_order_no, claim_amount, main_part_name, adjusted:raw_row->>"Adjusted Claim TOL.", first_submit:raw_row->>"First Submit Date", labor_name:raw_row->>"Main Labor Name"';

/**
 * Every Settled claim in one SAIC settlement order (optionally limited to
 * some branches), with its saved review. Reads through the settlement-order
 * expression index (migration 0069) - ~2,000 claims per order.
 */
export async function loadReconciliation(settlementOrder: string, branchIds: string[]): Promise<ReconciliationRow[]> {
  await requireRole("officer");
  const supabase = await createClient();

  const rows: Raw[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from("self_audit_claims")
      .select(SELECT)
      .eq('raw_row->>"Settlement Order"', settlementOrder)
      .eq("raw_row->>Status", "Settled");
    if (branchIds.length) q = q.in("branch_id", branchIds);
    const { data, error } = await q.order("claim_number").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message || "Timed out loading the settlement.");
    const page = (data ?? []) as unknown as Raw[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  const reviews = new Map<string, { deduction_type: ReconciliationRow["deductionType"]; outcome: ReconciliationRow["outcome"]; notes: string | null; updated_at: string }>();
  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await supabase
      .from("self_audit_reconciliation")
      .select("claim_id, deduction_type, outcome, notes, updated_at")
      .in("claim_id", ids.slice(i, i + 300));
    if (error) throw new Error(error.message);
    for (const r of data ?? []) reviews.set(r.claim_id, r);
  }

  return rows.map((r) => {
    const claimAmount = Number(r.claim_amount) || 0;
    const adjusted = r.adjusted != null && r.adjusted !== "" ? Number(r.adjusted) : claimAmount;
    const review = reviews.get(r.id);
    return {
      claimId: r.id,
      branchId: r.branch_id,
      vin: r.vin,
      claimNumber: r.claim_number,
      workOrderNo: r.work_order_no,
      claimAmount,
      adjustedAmount: adjusted,
      lossAmount: Math.round((claimAmount - adjusted) * 100) / 100,
      firstSubmitDate: r.first_submit ? r.first_submit.replace(/\//g, "-").slice(0, 10) : null,
      laborName: r.labor_name,
      partName: r.main_part_name,
      deductionType: review?.deduction_type ?? null,
      outcome: review?.outcome ?? null,
      notes: review?.notes ?? null,
      updatedAt: review?.updated_at ?? null,
    };
  });
}

/** Saves one claim's review. Only the fields passed are changed. */
export async function saveReconciliation(
  claimId: string,
  patch: { deductionType?: "saic" | "internal" | null; outcome?: "reinvoiced" | "overdue" | null; notes?: string | null }
): Promise<{ error?: string; updatedAt?: string }> {
  const user = await requireRole("officer");
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("self_audit_reconciliation")
    .select("deduction_type, outcome, notes")
    .eq("claim_id", claimId)
    .maybeSingle();

  const row = {
    claim_id: claimId,
    deduction_type: patch.deductionType !== undefined ? patch.deductionType : (existing?.deduction_type ?? null),
    outcome: patch.outcome !== undefined ? patch.outcome : (existing?.outcome ?? null),
    notes: patch.notes !== undefined ? patch.notes?.trim() || null : (existing?.notes ?? null),
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("self_audit_reconciliation").upsert(row, { onConflict: "claim_id" });
  if (error) return { error: error.message };
  return { updatedAt: row.updated_at };
}
