"use server";

import { siteOrigin } from "@/lib/site-origin";
import { mailScrapEvidence } from "@/lib/mail/scrap-evidence";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { headers } from "next/headers";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DriveError, ensureScrapBranchFolder, getDriveStatus, getFileMeta, startResumableUpload, syncDriveSharing, trashFile } from "@/lib/google-drive";
import { EVIDENCE_MAX_VIDEOS, EVIDENCE_MAX_VIDEO_BYTES, evidenceMonthLabel } from "@/lib/warranty-room/evidence-limits";
import { formatBytes } from "@/lib/feedback-constants";

/** A video the browser has already uploaded to Google Drive. */
export type EvidenceVideoInput = { driveFileId: string; name: string; type: string; size: number };

const NOT_CONNECTED = "Google Drive is not connected yet - ask an officer to connect it.";
const safeDriveName = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim().slice(0, 180) || "video";
const driveMessage = (e: unknown) => (e instanceof DriveError ? e.message : "Could not reach Google Drive - please try again.");

/**
 * Step 1 of adding videos: makes sure this branch's Drive folder for the cycle
 * exists (Scrap evidence / <MM-YYYY> / <branch>) and opens one upload session
 * per video. The browser then sends each video straight to Google - a video is
 * far too big for a server action body - and calls addDestroyEvidenceVideos
 * when it is done.
 */
export async function prepareEvidenceUploads(input: {
  cycleId: string;
  files: { name: string; type: string; size: number }[];
}): Promise<{ uploads?: { sessionUrl: string }[]; error?: string }> {
  const user = await requireRole("branch_admin");
  const supabase = await createClient();
  const branchId = user.branch_id!;

  if (input.files.length === 0) return { error: "Choose a video first." };
  for (const f of input.files) {
    if (!f.type.startsWith("video/")) return { error: `"${f.name}" is not a video.` };
    if (!(f.size >= 1) || f.size > EVIDENCE_MAX_VIDEO_BYTES) return { error: `"${f.name}" must be a video of at most ${formatBytes(EVIDENCE_MAX_VIDEO_BYTES)}.` };
  }

  const { data: existing } = await supabase.from("self_audit_destroy_evidence").select("status").eq("cycle_id", input.cycleId).eq("branch_id", branchId).maybeSingle();
  if (existing && existing.status !== "pending") return { error: "Already submitted for this cycle." };
  const { count } = await supabase.from("self_audit_destroy_evidence_videos").select("id", { count: "exact", head: true }).eq("cycle_id", input.cycleId).eq("branch_id", branchId);
  if ((count ?? 0) + input.files.length > EVIDENCE_MAX_VIDEOS) return { error: `You can add at most ${EVIDENCE_MAX_VIDEOS} videos per cycle.` };

  const [{ data: cycle }, { data: branch }] = await Promise.all([
    supabase.from("self_audit_warranty_room_cycles").select("cycle_month").eq("id", input.cycleId).maybeSingle(),
    supabase.from("self_audit_branches").select("name").eq("id", branchId).maybeSingle(),
  ]);
  if (!cycle) return { error: "Warranty room cycle not found." };
  if (!(await getDriveStatus())) return { error: NOT_CONNECTED };
  const origin = (await headers()).get("origin");
  if (!origin) return { error: "Something went wrong - please reload the page and try again." };

  try {
    const folder = await ensureScrapBranchFolder(evidenceMonthLabel(cycle.cycle_month), branchId, branch?.name ?? "Branch");
    const uploads = await Promise.all(
      input.files.map(async (f) => ({
        sessionUrl: await startResumableUpload({ parentId: folder, name: safeDriveName(f.name), mimeType: f.type, size: f.size, origin }),
      }))
    );
    return { uploads };
  } catch (e) {
    return { error: driveMessage(e) };
  }
}

/**
 * Step 2: records videos the browser has uploaded. Each is checked with Google
 * first - it exists, is not trashed, sits in this branch's folder for the cycle
 * and is a sane video - so an invented id cannot get in. Videos are managed
 * incrementally (add one, delete one) so a branch the officer sent back can
 * change individual videos instead of starting over.
 */
export async function addDestroyEvidenceVideos(cycleId: string, files: EvidenceVideoInput[]): Promise<{ error?: string }> {
  const user = await requireRole("branch_admin");
  const supabase = await createClient();
  const branchId = user.branch_id!;
  if (files.length === 0) return {};

  const { data: existing } = await supabase.from("self_audit_destroy_evidence").select("status").eq("cycle_id", cycleId).eq("branch_id", branchId).maybeSingle();
  if (existing && existing.status !== "pending") return { error: "Already submitted for this cycle." };

  const { data: cycle } = await supabase.from("self_audit_warranty_room_cycles").select("cycle_month").eq("id", cycleId).maybeSingle();
  if (!cycle) return { error: "Warranty room cycle not found." };
  const { data: folder } = await createAdminClient()
    .from("self_audit_drive_folders")
    .select("drive_id")
    .eq("key", `scrap:branch:${evidenceMonthLabel(cycle.cycle_month)}:${branchId}`)
    .maybeSingle();
  if (!folder) return { error: "The upload folder was not found - please add the videos again." };

  const unique = files.filter((f, i) => files.findIndex((g) => g.driveFileId === f.driveFileId) === i);
  const rows: { cycle_id: string; branch_id: string; drive_file_id: string; drive_url: string | null; file_name: string; mime_type: string; size_bytes: number }[] = [];
  try {
    const metas = await Promise.all(unique.map((f) => getFileMeta(f.driveFileId)));
    for (let i = 0; i < unique.length; i++) {
      const meta = metas[i];
      if (!meta || meta.trashed || !meta.parents.includes(folder.drive_id)) return { error: `"${unique[i].name}" did not finish uploading - please add it again.` };
      if (!meta.mimeType.startsWith("video/")) return { error: `"${meta.name}" is not a video.` };
      if (meta.size < 1 || meta.size > EVIDENCE_MAX_VIDEO_BYTES) return { error: `"${meta.name}" is larger than ${formatBytes(EVIDENCE_MAX_VIDEO_BYTES)}.` };
      rows.push({ cycle_id: cycleId, branch_id: branchId, drive_file_id: meta.id, drive_url: meta.webViewLink, file_name: meta.name, mime_type: meta.mimeType, size_bytes: meta.size });
    }
  } catch (e) {
    return { error: driveMessage(e) };
  }

  if (!existing) {
    const { error: insertError } = await supabase.from("self_audit_destroy_evidence").insert({ cycle_id: cycleId, branch_id: branchId, status: "pending" });
    if (insertError) return { error: insertError.message };
  }

  // A retry after a failed save must not record the same video twice.
  const { data: known } = await supabase.from("self_audit_destroy_evidence_videos").select("drive_file_id").eq("cycle_id", cycleId).eq("branch_id", branchId);
  const knownIds = new Set((known ?? []).map((k) => k.drive_file_id));
  const fresh = rows.filter((r) => !knownIds.has(r.drive_file_id));
  if (fresh.length > 0) {
    const { error } = await supabase.from("self_audit_destroy_evidence_videos").insert(fresh);
    if (error) return { error: error.message };
  }

  // The branch's admins get view access to their folder, the officers to Scrap evidence - best effort, after the response.
  after(async () => {
    try {
      await syncDriveSharing({ branchId });
    } catch (e) {
      console.error("Scrap evidence sharing failed:", e instanceof Error ? e.message : e);
    }
  });

  revalidatePath("/audit/warranty-room");
  return {};
}

/** Lets a branch admin drop one already-uploaded video before submitting (the file goes to the Drive trash, recoverable there). */
export async function deleteDestroyEvidenceVideo(videoId: string): Promise<{ error?: string }> {
  const user = await requireRole("branch_admin");
  const supabase = await createClient();

  const { data: video } = await supabase.from("self_audit_destroy_evidence_videos").select("branch_id, cycle_id, drive_file_id").eq("id", videoId).maybeSingle();
  if (!video || video.branch_id !== user.branch_id) return { error: "Video not found." };

  const { data: evidence } = await supabase.from("self_audit_destroy_evidence").select("status").eq("cycle_id", video.cycle_id).eq("branch_id", video.branch_id).maybeSingle();
  if (evidence && evidence.status !== "pending") return { error: "This submission is locked - it cannot be changed now." };

  try {
    await trashFile(video.drive_file_id);
  } catch (e) {
    return { error: driveMessage(e) };
  }
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
 * (addDestroyEvidenceVideos) by the time this is called - this just locks
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

  // The officers are told by e-mail (after the response; a failed mail never undoes the submission).
  const origin = await siteOrigin();
  after(() => mailScrapEvidence("submitted", { cycleId, branchId, by: user.full_name?.trim() || user.email, origin, userId: user.id }));
  revalidatePath("/audit/warranty-room");
  return {};
}
