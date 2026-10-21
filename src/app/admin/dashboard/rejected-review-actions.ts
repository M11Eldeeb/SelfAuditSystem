"use server";

import { requireRole, requireViewer } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/** Days after the verification date in which a rejected claim can still be appealed. */
const APPEAL_DAYS = 30;

export type RejectedReviewStatus = "resolved" | "appeal_submitted" | "confirmed_rejection";

export type RejectedReviewRow = {
  claimId: string;
  claimNumber: string;
  workOrder: string | null;
  vin: string | null;
  branch: string;
  status: string; // the claims export status (Rejected / Rejected from chief agent)
  verificationDate: string | null;
  deadline: string | null;
  daysLeft: number | null;
  amount: number;
  fault: string | null;
  labor: string | null;
  part: string | null;
  review: { status: RejectedReviewStatus | null; note: string | null; by: string | null; at: string } | null;
};

/** Every claim the claims export shows as rejected, with its 30-day appeal window and the officer's review. */
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
    ? await admin.from("self_audit_rejected_claim_reviews").select("claim_id, status, note, updated_by_name, updated_at").in("claim_id", ids)
    : { data: [] as { claim_id: string; status: string | null; note: string | null; updated_by_name: string | null; updated_at: string }[] };
  const reviewOf = new Map((reviews ?? []).map((r) => [r.claim_id, r]));
  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const today = Date.parse(new Date().toISOString().slice(0, 10));
  return (claims ?? []).map((c) => {
    const v = c.verification_date as string | null;
    const deadline = v ? new Date(Date.parse(v) + APPEAL_DAYS * 86_400_000).toISOString().slice(0, 10) : null;
    const r = reviewOf.get(c.id);
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
export async function saveRejectedClaimReview(claimId: string, status: RejectedReviewStatus | null, note: string): Promise<{ error?: string }> {
  const officer = await requireRole("officer");
  if (status !== null && !["resolved", "appeal_submitted", "confirmed_rejection"].includes(status)) return { error: "Unknown status." };
  const clean = note.trim().slice(0, 2000) || null;
  const admin = createAdminClient();
  if (!status && !clean) {
    const { error } = await admin.from("self_audit_rejected_claim_reviews").delete().eq("claim_id", claimId);
    return error ? { error: error.message } : {};
  }
  const { error } = await admin.from("self_audit_rejected_claim_reviews").upsert({
    claim_id: claimId,
    status,
    note: clean,
    updated_by: officer.id,
    updated_by_name: officer.full_name ?? officer.email,
    updated_at: new Date().toISOString(),
  });
  return error ? { error: error.message } : {};
}
