"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * "Download, then mark sent" for one branch's destruction evidence: deletes
 * the video files from storage (irreversible - the confirm dialog on the
 * client is the safety check) and marks the branch collected for this cycle.
 * Storage delete happens BEFORE the DB is touched - if it fails, the row
 * stays 'submitted' and the video rows stay put, so nothing is silently lost.
 */
export async function markDestroyEvidenceSent(cycleId: string, branchId: string): Promise<{ error?: string }> {
  const officer = await requireRole("officer");
  const supabase = await createClient();

  const { data: videos } = await supabase
    .from("self_audit_destroy_evidence_videos")
    .select("id, video_path")
    .eq("cycle_id", cycleId)
    .eq("branch_id", branchId);

  const paths = (videos ?? []).map((v) => v.video_path);
  if (paths.length > 0) {
    const { error: removeError } = await supabase.storage.from("warranty-room-files").remove(paths);
    if (removeError) return { error: `Could not delete video files: ${removeError.message}` };
  }

  const { error: videosDeleteError } = await supabase
    .from("self_audit_destroy_evidence_videos")
    .delete()
    .eq("cycle_id", cycleId)
    .eq("branch_id", branchId);
  if (videosDeleteError) return { error: videosDeleteError.message };

  const { error: updateError } = await supabase
    .from("self_audit_destroy_evidence")
    .update({ status: "sent", sent_at: new Date().toISOString(), sent_by: officer.id })
    .eq("cycle_id", cycleId)
    .eq("branch_id", branchId);
  if (updateError) return { error: updateError.message };

  revalidatePath(`/admin/warranty-room/destroy-evidence/${cycleId}`);
  revalidatePath("/admin/warranty-room/destroy-evidence");
  return {};
}
