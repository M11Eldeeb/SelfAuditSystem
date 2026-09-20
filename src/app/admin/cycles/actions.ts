"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { shiftMonth } from "@/lib/month";
import { shuffle } from "@/lib/shuffle";
import { getAuditedClaimIds } from "@/lib/audited-claims";
import { AUDIT_CYCLE_DEADLINE_DAYS } from "@/lib/cycle";
import { getWarrantyRoomExcludedClaimIds } from "@/lib/warranty-room/excluded-claims";

const CLAIMS_PER_BRANCH = 10;

// A claim in one of these states isn't a real, settled warranty case to
// audit - confirmed against real data (raw_row->>'Status' spellings exactly
// as the source export uses them): "Draft saved" never got submitted,
// "Rejected"/"Closed" are dead regardless of parts. Same reasoning
// get_do_not_scrap_claims already uses for which claims are worth
// flagging, applied here at sampling time instead of after the fact.
const CYCLE_EXCLUDED_STATUSES = new Set(["Draft saved", "Rejected", "Closed"]);

// Any status containing "returned" (case-insensitive) is excluded too, not
// just the one spelling seen so far ("Returned from chief agent") - the
// export could introduce "Returned to dealer" or similar later and this
// should catch it without needing another hardcoded string added by hand.
function isExcludedStatus(status: string): boolean {
  return CYCLE_EXCLUDED_STATUSES.has(status) || status.toLowerCase().includes("returned");
}

export type GenerateCycleState =
  | {
      error?: string;
      success?: string;
      perBranch?: { branchName: string; available: number; assigned: number }[];
      cycleMonthLabel?: string;
      notifyEmails?: string[];
    }
  | undefined;

export async function generateCycle(
  _prev: GenerateCycleState,
  formData: FormData
): Promise<GenerateCycleState> {
  const officer = await requireRole("officer");

  const cycleMonthInput = String(formData.get("cycle_month") ?? "");
  if (!cycleMonthInput) {
    return { error: "Select the audit cycle's month." };
  }

  const cycleMonth = shiftMonth(cycleMonthInput, 0);
  const claimsMonth = shiftMonth(cycleMonthInput, -1);

  const supabase = await createClient();

  const { data: branches } = await supabase
    .from("self_audit_branches")
    .select("id, name")
    .eq("active", true)
    .order("name");
  if (!branches || branches.length === 0) {
    return { error: "Add at least one active branch first." };
  }

  // Only the most recently uploaded claims sheet is used for generation -
  // older claims are cleaned up on upload, but this filter is a defensive
  // second layer in case any linger.
  const { data: latestBatch } = await supabase
    .from("self_audit_upload_batches")
    .select("id")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latestBatch) {
    return { error: "Upload a claims file first." };
  }

  const deadlineAt = new Date(Date.now() + AUDIT_CYCLE_DEADLINE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: cycle, error: cycleError } = await supabase
    .from("self_audit_audit_cycles")
    .insert({
      cycle_month: cycleMonth,
      claims_month: claimsMonth,
      status: "open",
      created_by: officer.id,
      deadline_at: deadlineAt,
    })
    .select("id")
    .single();

  if (cycleError || !cycle) {
    return {
      error: cycleError?.message.includes("duplicate")
        ? `An audit cycle for ${cycleMonthInput} already exists.`
        : (cycleError?.message ?? "Could not create the cycle."),
    };
  }

  // A claim already assigned to self-audit OR sampled into an internal audit
  // is never resampled by either workflow again - fetched once, filtered
  // per-branch in JS below. A claim the warranty room has already queued to
  // scrap, scrapped, or handed over to the supplier has no part left to
  // physically check, so it's excluded the same way.
  const [auditedClaimIds, warrantyRoomExcludedIds] = await Promise.all([
    getAuditedClaimIds(supabase),
    getWarrantyRoomExcludedClaimIds(supabase),
  ]);

  const perBranch: { branchName: string; available: number; assigned: number }[] = [];
  const notifiedBranchIds = new Set<string>();

  for (const branch of branches) {
    const { data: claims } = await supabase
      .from("self_audit_claims")
      .select("id, raw_row")
      .eq("branch_id", branch.id)
      .eq("upload_batch_id", latestBatch.id)
      .eq("has_parts", true)
      .gte("creation_date", claimsMonth)
      .lt("creation_date", cycleMonth);

    const available = (claims ?? []).filter(
      (c) =>
        !auditedClaimIds.has(c.id) &&
        !warrantyRoomExcludedIds.has(c.id) &&
        !isExcludedStatus(String((c.raw_row as Record<string, unknown> | null)?.Status ?? ""))
    );
    const selected = shuffle(available).slice(0, CLAIMS_PER_BRANCH);

    if (selected.length > 0) {
      const { error: assignError } = await supabase.from("self_audit_audit_assignments").insert(
        selected.map((c) => ({
          cycle_id: cycle.id,
          branch_id: branch.id,
          claim_id: c.id,
          status: "not_started" as const,
        }))
      );
      if (assignError) {
        return { error: `Failed assigning claims for ${branch.name}: ${assignError.message}` };
      }

      notifiedBranchIds.add(branch.id);
    }

    perBranch.push({ branchName: branch.name, available: available.length, assigned: selected.length });
  }

  revalidatePath("/admin/cycles");

  const { data: branchAdmins } = await supabase
    .from("self_audit_users")
    .select("email, branch_id")
    .eq("role", "branch_admin");
  const notifyEmails = [
    ...new Set(
      (branchAdmins ?? [])
        .filter((admin) => admin.branch_id && notifiedBranchIds.has(admin.branch_id))
        .map((admin) => admin.email)
    ),
  ];

  return {
    success: `Audit cycle for ${cycleMonthInput} created (auditing claims from ${claimsMonth.slice(0, 7)}).`,
    perBranch,
    cycleMonthLabel: cycleMonthInput,
    notifyEmails,
  };
}

// Deletes a cycle regardless of progress - including submitted/reviewed work,
// which is permanently lost (cascades away assignments, answers, photos, and
// ai_reviews). The confirm dialog on the client is the safety check here.
export async function deleteCycle(cycleId: string): Promise<{ error?: string }> {
  await requireRole("officer");

  const supabase = await createClient();

  const { error } = await supabase.from("self_audit_audit_cycles").delete().eq("id", cycleId);
  if (error) return { error: error.message };

  revalidatePath("/admin/cycles");
  return {};
}
