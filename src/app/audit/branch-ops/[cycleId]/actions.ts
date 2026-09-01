"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type SaveBranchOpsState = { error?: string } | undefined;

export async function saveBranchOps(
  cycleId: string,
  _prev: SaveBranchOpsState,
  formData: FormData
): Promise<SaveBranchOpsState> {
  const user = await requireRole("branch_admin");
  const supabase = await createClient();
  const branchId = user.branch_id!;

  const { data: assignments } = await supabase
    .from("self_audit_audit_assignments")
    .select("status")
    .eq("cycle_id", cycleId)
    .eq("branch_id", branchId);

  if (!assignments || assignments.length === 0) {
    return { error: "No assigned claims found for this cycle." };
  }
  if (assignments.some((a) => a.status === "not_started" || a.status === "in_progress")) {
    return { error: "Finish all assigned claims before submitting branch operations." };
  }

  const { data: progress } = await supabase
    .from("self_audit_branch_operation_progress")
    .select("status")
    .eq("cycle_id", cycleId)
    .eq("branch_id", branchId)
    .maybeSingle();

  if (progress && progress.status !== "not_started") {
    return { error: "This has already been submitted." };
  }

  const [{ data: questions }, { data: photoTypes }, { data: existingPhotos }] = await Promise.all([
    supabase.from("self_audit_audit_questions").select("id").eq("scope", "branch").order("sort_order"),
    supabase.from("self_audit_audit_photo_types").select("*").eq("scope", "branch").order("sort_order"),
    supabase
      .from("self_audit_branch_operation_photos")
      .select("photo_type_id")
      .eq("cycle_id", cycleId)
      .eq("branch_id", branchId)
      .is("deleted_at", null),
  ]);

  const answerRows = (questions ?? []).map((q) => {
    const value = formData.get(`answer_${q.id}`);
    return {
      cycle_id: cycleId,
      branch_id: branchId,
      question_id: q.id,
      answer_value: value ? String(value) : null,
    };
  });

  if (answerRows.some((r) => !r.answer_value)) {
    return { error: "Answer all questions before submitting." };
  }

  // The file itself is already uploaded client-side (PhotoUploadField) straight to
  // Supabase Storage - Vercel hard-caps a serverless function's request body at
  // 4.5MB regardless of Next's bodySizeLimit config. Only the resulting path
  // arrives here.
  const uploadedPhotoTypeIds = new Set((existingPhotos ?? []).map((p) => p.photo_type_id));
  for (const pt of photoTypes ?? []) {
    const path = formData.get(`photo_path_${pt.id}`);
    if (typeof path === "string" && path.startsWith(`branch-ops/${branchId}/${cycleId}/`)) {
      const { error: photoRowError } = await supabase.from("self_audit_branch_operation_photos").upsert(
        { cycle_id: cycleId, branch_id: branchId, photo_type_id: pt.id, storage_path: path },
        { onConflict: "cycle_id,branch_id,photo_type_id" }
      );
      if (photoRowError) return { error: photoRowError.message };
      uploadedPhotoTypeIds.add(pt.id);
    }
  }

  const missingPhotos = (photoTypes ?? []).filter((p) => p.required && !uploadedPhotoTypeIds.has(p.id));
  if (missingPhotos.length > 0) {
    return { error: `Missing required photo(s): ${missingPhotos.map((p) => p.label).join(", ")}` };
  }

  const { error: answersError } = await supabase
    .from("self_audit_branch_operation_answers")
    .upsert(answerRows, { onConflict: "cycle_id,branch_id,question_id" });
  if (answersError) return { error: answersError.message };

  const { error: progressError } = await supabase.from("self_audit_branch_operation_progress").upsert(
    {
      cycle_id: cycleId,
      branch_id: branchId,
      status: "submitted",
      submitted_at: new Date().toISOString(),
      submitted_by: user.id,
    },
    { onConflict: "cycle_id,branch_id" }
  );
  if (progressError) return { error: progressError.message };

  revalidatePath("/audit");
  redirect("/audit");
}
