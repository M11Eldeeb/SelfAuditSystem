"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Called once per uploaded file (the file itself is already in storage by
 * the time this runs - see submit-destroy-evidence.tsx). Videos are managed
 * incrementally - add one, delete one - rather than only ever submitted as
 * one fixed batch, so a branch the officer sends back (returnDestroyEvidence)
 * can add or remove individual videos instead of starting over.
 */
export async function addDestroyEvidenceVideo(cycleId: string, videoPath: string): Promise<{ error?: string }> {
  const user = await requireRole("branch_admin");
  const supabase = await createClient();
  const branchId = user.branch_id!;

  const { data: existing } = await supabase
    .from("self_audit_destroy_evidence")
    .select("status")
    .eq("cycle_id", cycleId)
    .eq("branch_id", branchId)
    .maybeSingle();
  if (existing && existing.status !== "pending") return { error: "Already submitted for this cycle." };

  if (!existing) {
    const { error: insertError } = await supabase
      .from("self_audit_destroy_evidence")
      .insert({ cycle_id: cycleId, branch_id: branchId, status: "pending" });
    if (insertError) return { error: insertError.message };
  }

  const { error } = await supabase
    .from("self_audit_destroy_evidence_videos")
    .insert({ cycle_id: cycleId, branch_id: branchId, video_path: videoPath });
  if (error) return { error: error.message };

  revalidatePath("/audit/warranty-room");
  return {};
}

/** Lets a branch admin drop one already-uploaded video before resubmitting (e.g. after the officer returned it, or before the first submit). */
export async function deleteDestroyEvidenceVideo(videoId: string, videoPath: string): Promise<{ error?: string }> {
  const user = await requireRole("branch_admin");
  const supabase = await createClient();

  const { data: video } = await supabase
    .from("self_audit_destroy_evidence_videos")
    .select("branch_id")
    .eq("id", videoId)
    .single();
  if (!video || video.branch_id !== user.branch_id) return { error: "Video not found." };

  const { error: removeError } = await supabase.storage.from("warranty-room-files").remove([videoPath]);
  if (removeError) return { error: removeError.message };

  const { error: deleteError } = await supabase.from("self_audit_destroy_evidence_videos").delete().eq("id", videoId);
  if (deleteError) return { error: deleteError.message };

  revalidatePath("/audit/warranty-room");
  return {};
}

/**
 * One bulk destruction-evidence submission per branch per warranty room
 * cycle - replaces submit_scrap_request (per-claim video) as the branch
 * admin's ongoing workflow. No deadline - a branch that never submits just
 * never gets its flagged parts approved onto the Scrapped List, which is
 * enforcement enough on its own. Videos themselves are already attached
 * (addDestroyEvidenceVideo) by the time this is called - this just locks
 * the cycle in as submitted.
 */
export async function submitDestroyEvidence(cycleId: string): Promise<{ error?: string }> {
  const user = await requireRole("branch_admin");
  const supabase = await createClient();
  const branchId = user.branch_id!;

  const { data: cycle } = await supabase
    .from("self_audit_warranty_room_cycles")
    .select("id")
    .eq("id", cycleId)
    .single();
  if (!cycle) return { error: "Warranty room cycle not found." };

  const { count } = await supabase
    .from("self_audit_destroy_evidence_videos")
    .select("id", { count: "exact", head: true })
    .eq("cycle_id", cycleId)
    .eq("branch_id", branchId);
  if (!count) return { error: "Upload at least one video first." };

  const { error } = await supabase
    .from("self_audit_destroy_evidence")
    .update({ status: "submitted", submitted_at: new Date().toISOString(), submitted_by: user.id })
    .eq("cycle_id", cycleId)
    .eq("branch_id", branchId)
    .eq("status", "pending");
  if (error) return { error: error.message };

  revalidatePath("/audit/warranty-room");
  return {};
}
