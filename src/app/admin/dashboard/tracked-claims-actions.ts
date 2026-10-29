"use server";

import { requireRole, requireViewer } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export type TrackedClaim = {
  claimNumber: string;
  note: string | null;
  completed: boolean;
  completedAt: string | null;
  completedBy: string | null;
  addedAt: string;
  addedBy: string | null;
  /** Null until the claim is in an uploaded claims export. */
  claim: { status: string | null; mainPart: string | null; workOrder: string | null; total: number | null; branch: string | null; firstSubmit: string | null; repairEnd: string | null } | null;
};
export type TrackedClaimsData = { rows: TrackedClaim[]; lastUpload: string | null; canEdit: boolean };

const clean = (v: string) => v.trim().toUpperCase().replace(/\s+/g, "");

/** Officers: every tracked claim number with its data from the latest claims upload (when it is there yet). */
export async function getTrackedClaims(): Promise<TrackedClaimsData> {
  const user = await requireViewer("officer");
  const admin = createAdminClient();
  const [{ data: tracked }, { data: branches }, { data: last }] = await Promise.all([
    admin.from("self_audit_tracked_claims").select("*").order("added_at", { ascending: false }),
    admin.from("self_audit_branches").select("id, name"),
    admin.from("self_audit_upload_batches").select("uploaded_at").order("uploaded_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const numbers = (tracked ?? []).map((t) => t.claim_number);
  const names = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const found = new Map<string, NonNullable<TrackedClaim["claim"]>>();
  for (let i = 0; i < numbers.length; i += 200) {
    const { data: claims } = await admin
      .from("self_audit_claims")
      .select("id, claim_number, branch_id, work_order_no, main_part_name, claim_amount, repair_end_date")
      .in("claim_number", numbers.slice(i, i + 200));
    const ids = (claims ?? []).map((c) => c.id);
    if (!ids.length) continue;
    const { data: st } = await admin.from("self_audit_claim_settlement").select("claim_id, status, first_submit").in("claim_id", ids);
    const stOf = new Map((st ?? []).map((x) => [x.claim_id, x]));
    for (const c of claims ?? []) {
      found.set(c.claim_number.toUpperCase(), {
        status: stOf.get(c.id)?.status ?? null,
        mainPart: c.main_part_name,
        workOrder: c.work_order_no,
        total: c.claim_amount == null ? null : Number(c.claim_amount),
        branch: names.get(c.branch_id) ?? null,
        firstSubmit: stOf.get(c.id)?.first_submit ?? null,
        repairEnd: c.repair_end_date,
      });
    }
  }
  return {
    rows: (tracked ?? []).map((t) => ({
      claimNumber: t.claim_number,
      note: t.note,
      completed: t.completed,
      completedAt: t.completed_at,
      completedBy: t.completed_by_name,
      addedAt: t.added_at,
      addedBy: t.added_by_name,
      claim: found.get(t.claim_number.toUpperCase()) ?? null,
    })),
    lastUpload: last?.uploaded_at ?? null,
    canEdit: !user.viewOnly,
  };
}

/** Officers: adds claim numbers (one or many, separated by spaces, commas or new lines). Known ones are left as they are. */
export async function addTrackedClaims(input: string, note?: string): Promise<{ added?: number; error?: string }> {
  const officer = await requireRole("officer");
  const list = [...new Set(input.split(/[\s,;]+/).map(clean).filter(Boolean))];
  if (!list.length) return { error: "Enter at least one claim number." };
  if (list.length > 200) return { error: "Add up to 200 claim numbers at a time." };
  if (list.some((n) => !/^[A-Z0-9-]{4,40}$/.test(n))) return { error: "A claim number can only have letters, digits and dashes." };
  const name = officer.full_name ?? officer.email;
  const { data, error } = await createAdminClient()
    .from("self_audit_tracked_claims")
    .upsert(
      list.map((n) => ({ claim_number: n, note: note?.trim().slice(0, 2000) || null, added_by: officer.id, added_by_name: name, updated_by_name: name })),
      { onConflict: "claim_number", ignoreDuplicates: true }
    )
    .select("claim_number");
  if (error) return { error: error.message };
  return { added: (data ?? []).length };
}

/** Officers: the note and / or completed flag of one tracked claim. */
export async function updateTrackedClaim(claimNumber: string, patch: { note?: string | null; completed?: boolean }): Promise<{ error?: string }> {
  const officer = await requireRole("officer");
  const name = officer.full_name ?? officer.email;
  const now = new Date().toISOString();
  const update: { updated_at: string; updated_by_name: string; note?: string | null; completed?: boolean; completed_at?: string | null; completed_by_name?: string | null } = { updated_at: now, updated_by_name: name };
  if (patch.note !== undefined) update.note = patch.note?.trim().slice(0, 2000) || null;
  if (patch.completed !== undefined) {
    update.completed = patch.completed;
    update.completed_at = patch.completed ? now : null;
    update.completed_by_name = patch.completed ? name : null;
  }
  const { error } = await createAdminClient().from("self_audit_tracked_claims").update(update).eq("claim_number", claimNumber);
  return error ? { error: error.message } : {};
}

/** Officers: stops tracking a claim. */
export async function removeTrackedClaim(claimNumber: string): Promise<{ error?: string }> {
  await requireRole("officer");
  const { error } = await createAdminClient().from("self_audit_tracked_claims").delete().eq("claim_number", claimNumber);
  return error ? { error: error.message } : {};
}
