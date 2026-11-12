"use server";

import { requireRole, requireViewer } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export type RejectedReviewStatus = "resolved" | "appeal_submitted" | "confirmed_rejection";

export type RejectedReviewRow = {
  claimId: string;
  claimNumber: string;
  workOrder: string | null;
  vin: string | null;
  branch: string;
  status: string; // the claims export status (Rejected / Rejected from chief agent)
  verificationDate: string | null;
  /** The estimated claim close date the officer entered (the appeal deadline), or null while not entered. */
  deadline: string | null;
  daysLeft: number | null;
  amount: number;
  fault: string | null;
  labor: string | null;
  part: string | null;
  review: { status: RejectedReviewStatus | null; note: string | null; by: string | null; at: string } | null;
};

/** Every claim the claims export shows as rejected, with the close date the officer entered and the officer's review. */
export async function getRejectedClaimsForReview(): Promise<RejectedReviewRow[]> {
  await requireViewer("officer");
  const admin = createAdminClient();
  const [{ data: claims }, { data: branches }] = await Promise.all([
    admin
      .from("self_audit_claims")
      .select('id, branch_id, claim_number, work_order_no, vin, claim_amount, main_part_name, verification_date, status:raw_row->>Status, fault:raw_row->>"Fault Description", labor:raw_row->>"Main Labor Name"')
      .like("raw_row->>Status", "Rejected%")
      .order("verification_date", { ascending: false })
      .limit(2000),
    admin.from("self_audit_branches").select("id, name"),
  ]);
  const ids = (claims ?? []).map((c) => c.id);
  const { data: reviews } = ids.length
    ? await admin.from("self_audit_rejected_claim_reviews").select("claim_id, status, note, close_date, updated_by_name, updated_at").in("claim_id", ids)
    : { data: [] as { claim_id: string; status: string | null; note: string | null; close_date: string | null; updated_by_name: string | null; updated_at: string }[] };
  const reviewOf = new Map((reviews ?? []).map((r) => [r.claim_id, r]));
  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const today = Date.parse(new Date().toISOString().slice(0, 10));
  return (claims ?? []).map((c) => {
    const v = c.verification_date as string | null;
    const r = reviewOf.get(c.id);
    const deadline = r?.close_date ?? null;
    return {
      claimId: c.id,
      claimNumber: c.claim_number,
      workOrder: c.work_order_no,
      vin: c.vin,
      branch: branchName.get(c.branch_id) ?? "",
      status: String(c.status ?? "Rejected"),
      verificationDate: v,
      deadline,
      daysLeft: deadline ? Math.round((Date.parse(deadline) - today) / 86_400_000) : null,
      amount: Number(c.claim_amount ?? 0),
      fault: (c.fault as string | null) ?? null,
      labor: (c.labor as string | null) ?? null,
      part: c.main_part_name,
      review: r ? { status: (r.status as RejectedReviewStatus | null) ?? null, note: r.note, by: r.updated_by_name, at: r.updated_at } : null,
    };
  });
}

/** Saves the officer's review of a rejected claim: the outcome (or none yet) and notes. */
export async function saveRejectedClaimReview(claimId: string, status: RejectedReviewStatus | null, note: string, closeDate: string | null): Promise<{ error?: string }> {
  const officer = await requireRole("officer");
  if (status !== null && !["resolved", "appeal_submitted", "confirmed_rejection"].includes(status)) return { error: "Unknown status." };
  const clean = note.trim().slice(0, 2000) || null;
  const close = closeDate && /^\d{4}-\d{2}-\d{2}$/.test(closeDate) ? closeDate : null;
  const admin = createAdminClient();
  if (!status && !clean && !close) {
    const { error } = await admin.from("self_audit_rejected_claim_reviews").delete().eq("claim_id", claimId);
    return error ? { error: error.message } : {};
  }
  const { error } = await admin.from("self_audit_rejected_claim_reviews").upsert({
    claim_id: claimId,
    status,
    note: clean,
    close_date: close,
    updated_by: officer.id,
    updated_by_name: officer.full_name ?? officer.email,
    updated_at: new Date().toISOString(),
  });
  return error ? { error: error.message } : {};
}

export type RejectedBatchSummary = {
  /** Claims of the claims batch whose status is Rejected (or Rejected from chief agent). */
  total: number;
  /** Of those, reviewed as resolved. */
  solved: number;
  /** Not solved yet: total minus solved. */
  left: number;
  /** Of the left ones: an appeal is submitted / the rejection is confirmed / nobody reviewed it yet. */
  appealSubmitted: number;
  confirmedRejection: number;
  notReviewed: number;
  /** Claim amount of the ones left. */
  amountLeft: number;
  amountTotal: number;
};

/** How many rejected claims of the claims batch are solved and how many are left, for the given branches (all periods). */
export async function getRejectedBatchSummary(branchIds: string[]): Promise<RejectedBatchSummary> {
  await requireViewer("officer");
  const admin = createAdminClient();
  const claims: { id: string; branch_id: string; claim_amount: number | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await admin
      .from("self_audit_claims")
      .select("id, branch_id, claim_amount")
      .like("raw_row->>Status", "Rejected%")
      .order("id")
      .range(from, from + 999);
    claims.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }
  const { data: reviews } = await admin.from("self_audit_rejected_claim_reviews").select("claim_id, status");
  const statusOf = new Map((reviews ?? []).map((r) => [r.claim_id, r.status as RejectedReviewStatus | null]));
  const scope = new Set(branchIds);
  const out: RejectedBatchSummary = { total: 0, solved: 0, left: 0, appealSubmitted: 0, confirmedRejection: 0, notReviewed: 0, amountLeft: 0, amountTotal: 0 };
  for (const c of claims) {
    if (!scope.has(c.branch_id)) continue;
    const amount = Number(c.claim_amount ?? 0);
    const status = statusOf.get(c.id) ?? null;
    out.total += 1;
    out.amountTotal += amount;
    if (status === "resolved") {
      out.solved += 1;
      continue;
    }
    out.left += 1;
    out.amountLeft += amount;
    if (status === "appeal_submitted") out.appealSubmitted += 1;
    else if (status === "confirmed_rejection") out.confirmedRejection += 1;
    else out.notReviewed += 1;
  }
  return out;
}
