"use server";

import { after } from "next/server";
import { siteOrigin } from "@/lib/site-origin";
import { mailScrapEvidence } from "@/lib/mail/scrap-evidence";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Approves one branch's destruction evidence for this cycle: every part still flagged for the branch - flagged in this
 * cycle or carried over from an earlier one the branch never submitted - moves to 'scrapped' (via the
 * approve_destroy_evidence RPC, migration 0135), and the branch's earlier cycles' evidence is closed with it. Parts
 * flagged in a LATER cycle are untouched. The videos stay in Drive.
 */
export async function approveDestroyEvidence(cycleId: string, branchId: string): Promise<{ error?: string; scrappedCount?: number }> {
  const officer = await requireRole("officer");
  const supabase = await createClient();

  const { data: scrappedCount, error: approveError } = await supabase.rpc("approve_destroy_evidence", {
    p_cycle_id: cycleId,
    p_branch_id: branchId,
  });
  if (approveError) return { error: approveError.message };

  // The branch's admins are told by e-mail (after the response; a failed mail never undoes the approval).
  const origin = await siteOrigin();
  after(() => mailScrapEvidence("approved", { cycleId, branchId, by: officer.full_name?.trim() || officer.email, origin, userId: officer.id, scrapped: scrappedCount ?? 0 }));
  revalidatePath(`/admin/warranty-room/destroy-evidence/${cycleId}`);
  revalidatePath("/admin/warranty-room/destroy-evidence");
  return { scrappedCount: scrappedCount ?? undefined };
}

/**
 * Sends a submission back to the branch to add or remove videos before
 * resubmitting - flips status back to 'pending' without touching the videos
 * already uploaded (the branch admin's page lists and can delete them
 * individually, or add more, once it's unlocked again).
 */
export async function returnDestroyEvidence(cycleId: string, branchId: string): Promise<{ error?: string }> {
  await requireRole("officer");
  const supabase = await createClient();

  const { error } = await supabase
    .from("self_audit_destroy_evidence")
    .update({ status: "pending", submitted_at: null, submitted_by: null })
    .eq("cycle_id", cycleId)
    .eq("branch_id", branchId);
  if (error) return { error: error.message };

  revalidatePath(`/admin/warranty-room/destroy-evidence/${cycleId}`);
  revalidatePath("/admin/warranty-room/destroy-evidence");
  revalidatePath("/audit/warranty-room");
  return {};
}
