import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Deletes the actual storage bytes for a claim's photos once the officer has
 * reviewed it, to stay within Supabase's free-tier storage limit. The
 * audit_photos rows are kept (deleted_at marks them) so the UI can still show
 * "uploaded, cleaned up after review" instead of "never uploaded".
 */
export async function cleanupAssignmentPhotos(assignmentId: string): Promise<void> {
  const supabase = createAdminClient();

  const { data: photos } = await supabase
    .from("self_audit_audit_photos")
    .select("id, storage_path")
    .eq("assignment_id", assignmentId)
    .is("deleted_at", null);

  if (!photos || photos.length === 0) return;

  await supabase.storage.from("audit-photos").remove(photos.map((p) => p.storage_path));
  await supabase
    .from("self_audit_audit_photos")
    .update({ deleted_at: new Date().toISOString() })
    .in(
      "id",
      photos.map((p) => p.id)
    );
}

/** Same idea as cleanupAssignmentPhotos, for the branch-operation photos. */
export async function cleanupBranchOpsPhotos(cycleId: string, branchId: string): Promise<void> {
  const supabase = createAdminClient();

  const { data: photos } = await supabase
    .from("self_audit_branch_operation_photos")
    .select("storage_path")
    .eq("cycle_id", cycleId)
    .eq("branch_id", branchId)
    .is("deleted_at", null);

  if (!photos || photos.length === 0) return;

  await supabase.storage.from("audit-photos").remove(photos.map((p) => p.storage_path));
  await supabase
    .from("self_audit_branch_operation_photos")
    .update({ deleted_at: new Date().toISOString() })
    .eq("cycle_id", cycleId)
    .eq("branch_id", branchId)
    .is("deleted_at", null);
}
