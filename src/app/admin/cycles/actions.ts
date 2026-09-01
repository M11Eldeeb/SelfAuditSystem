"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { shiftMonth } from "@/lib/month";
import { shuffle } from "@/lib/shuffle";
import { getAuditedClaimIds } from "@/lib/audited-claims";

const CLAIMS_PER_BRANCH = 10;

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

  const deadlineAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

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
  // per-branch in JS below.
  const auditedClaimIds = await getAuditedClaimIds(supabase);

  const perBranch: { branchName: string; available: number; assigned: number }[] = [];
  const notifiedBranchIds = new Set<string>();

  for (const branch of branches) {
    const { data: claims } = await supabase
      .from("self_audit_claims")
      .select("id")
      .eq("branch_id", branch.id)
      .eq("upload_batch_id", latestBatch.id)
      .eq("has_parts", true)
      .gte("creation_date", claimsMonth)
      .lt("creation_date", cycleMonth);

    const available = (claims ?? []).filter((c) => !auditedClaimIds.has(c.id));
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
