"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Approves one branch's destruction evidence for THIS cycle: moves that
 * branch's 'pending' scrap requests flagged in this specific cycle to
 * 'scrapped' (via the approve_destroy_evidence RPC - the actual decision,
 * done first so it's never lost) - an older, still-unsubmitted cycle for
 * the same branch is untouched, so it can be approved or returned
 * independently. Then deletes the video files from storage and their rows
 * (irreversible - the confirm dialog on the client is the safety check).
 * If the cleanup fails after approval, the approval itself still stands;
 * only the video cleanup needs retrying.
 */
export async function approveDestroyEvidence(cycleId: string, branchId: string): Promise<{ error?: string; scrappedCount?: number }> {
  await requireRole("officer");
  const supabase = await createClient();

  const { data: scrappedCount, error: approveError } = await supabase.rpc("approve_destroy_evidence", {
    p_cycle_id: cycleId,
    p_branch_id: branchId,
  });
  if (approveError) return { error: approveError.message };

  const { data: videos } = await supabase
    .from("self_audit_destroy_evidence_videos")
    .select("id, video_path")
    .eq("cycle_id", cycleId)
    .eq("branch_id", branchId);

  const paths = (videos ?? []).map((v) => v.video_path);
  if (paths.length > 0) {
    const { error: removeError } = await supabase.storage.from("warranty-room-files").remove(paths);
    if (removeError) return { error: `Approved, but could not delete video files: ${removeError.message}`, scrappedCount: scrappedCount ?? undefined };
  }

  const { error: videosDeleteError } = await supabase
    .from("self_audit_destroy_evidence_videos")
    .delete()
    .eq("cycle_id", cycleId)
    .eq("branch_id", branchId);
  if (videosDeleteError) return { error: `Approved, but could not clean up video records: ${videosDeleteError.message}`, scrappedCount: scrappedCount ?? undefined };

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
