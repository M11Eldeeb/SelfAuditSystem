"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Approves one branch's destruction evidence for THIS cycle: moves that
 * branch's 'pending' scrap requests flagged in this specific cycle to
 * 'scrapped' (via the approve_destroy_evidence RPC) - an older,
 * still-unsubmitted cycle for the same branch is untouched, so it can be
 * approved or returned independently. The videos are left in place so the
 * officer can still download them; deleteDestroyEvidenceVideos frees the
 * storage once they have.
 */
export async function approveDestroyEvidence(cycleId: string, branchId: string): Promise<{ error?: string; scrappedCount?: number }> {
  await requireRole("officer");
  const supabase = await createClient();

  const { data: scrappedCount, error: approveError } = await supabase.rpc("approve_destroy_evidence", {
    p_cycle_id: cycleId,
    p_branch_id: branchId,
  });
  if (approveError) return { error: approveError.message };

  revalidatePath(`/admin/warranty-room/destroy-evidence/${cycleId}`);
  revalidatePath("/admin/warranty-room/destroy-evidence");
  return { scrappedCount: scrappedCount ?? undefined };
}

/**
 * Permanently deletes one branch's videos for this cycle (storage files, then
 * their rows) to free Supabase storage. Irreversible - the confirm dialog on
 * the client is the safety check. Storage goes first and must remove every
 * file: if it fails or removes fewer than asked, the rows are kept so the
 * officer can see what is left and retry, rather than orphaning files in
 * storage with no record pointing at them.
 */
export async function deleteDestroyEvidenceVideos(cycleId: string, branchId: string): Promise<{ error?: string }> {
  await requireRole("officer");
  const supabase = await createClient();

  const { data: videos, error: listError } = await supabase
    .from("self_audit_destroy_evidence_videos")
    .select("id, video_path")
    .eq("cycle_id", cycleId)
    .eq("branch_id", branchId);
  if (listError) return { error: listError.message };
  if (!videos || videos.length === 0) return { error: "There are no videos to delete." };

  const paths = videos.map((v) => v.video_path);
  const { data: removed, error: removeError } = await supabase.storage.from("warranty-room-files").remove(paths);
  if (removeError) return { error: `Could not delete the video files: ${removeError.message}` };
  if ((removed ?? []).length < paths.length) {
    return { error: `Only ${(removed ?? []).length} of ${paths.length} video files were deleted - try again.` };
  }

  const { error: rowsError } = await supabase
    .from("self_audit_destroy_evidence_videos")
    .delete()
    .in(
      "id",
      videos.map((v) => v.id)
    );
  if (rowsError) return { error: `Files deleted, but could not clean up video records: ${rowsError.message}` };

  revalidatePath(`/admin/warranty-room/destroy-evidence/${cycleId}`);
  revalidatePath("/admin/warranty-room/destroy-evidence");
  revalidatePath("/audit/warranty-room");
  return {};
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
