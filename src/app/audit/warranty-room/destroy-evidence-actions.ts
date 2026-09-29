"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type SubmitDestroyEvidenceState = { error?: string } | undefined;

/**
 * One bulk destruction-evidence submission per branch per self-audit cycle -
 * replaces submit_scrap_request (per-claim video) as the branch admin's
 * ongoing workflow. Same 25-day deadline as the self-audit cycle itself
 * (deadline_at, set at cycle creation - see src/lib/cycle.ts).
 */
export async function submitDestroyEvidence(
  cycleId: string,
  videoPaths: string[]
): Promise<SubmitDestroyEvidenceState> {
  const user = await requireRole("branch_admin");
  const supabase = await createClient();
  const branchId = user.branch_id!;

  if (videoPaths.length === 0) return { error: "Upload at least one video first." };

  const { data: cycle } = await supabase
    .from("self_audit_audit_cycles")
    .select("deadline_at")
    .eq("id", cycleId)
    .single();
  if (!cycle) return { error: "Audit cycle not found." };
  if (cycle.deadline_at && new Date(cycle.deadline_at).getTime() < Date.now()) {
    return { error: "The submission deadline for this cycle has passed." };
  }

  const { data: existing } = await supabase
    .from("self_audit_destroy_evidence")
    .select("status")
    .eq("cycle_id", cycleId)
    .eq("branch_id", branchId)
    .maybeSingle();
  if (existing && existing.status !== "pending") {
    return { error: "Destruction evidence has already been submitted for this cycle." };
  }

  const { error: upsertError } = await supabase.from("self_audit_destroy_evidence").upsert(
    {
      cycle_id: cycleId,
      branch_id: branchId,
      status: "submitted",
      submitted_at: new Date().toISOString(),
      submitted_by: user.id,
    },
    { onConflict: "cycle_id,branch_id" }
  );
  if (upsertError) return { error: upsertError.message };

  const { error: videosError } = await supabase.from("self_audit_destroy_evidence_videos").insert(
    videoPaths.map((path) => ({ cycle_id: cycleId, branch_id: branchId, video_path: path }))
  );
  if (videosError) return { error: videosError.message };

  revalidatePath("/audit/warranty-room");
  return {};
}
