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
    .from("audit_assignments")
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
    .from("branch_operation_progress")
    .select("status")
    .eq("cycle_id", cycleId)
    .eq("branch_id", branchId)
    .maybeSingle();

  if (progress && progress.status !== "not_started") {
    return { error: "This has already been submitted." };
  }

  const { data: questions } = await supabase
    .from("audit_questions")
    .select("id")
    .eq("scope", "branch")
    .order("sort_order");

  const rows = (questions ?? []).map((q) => {
    const value = formData.get(`answer_${q.id}`);
    return {
      cycle_id: cycleId,
      branch_id: branchId,
      question_id: q.id,
      answer_value: value ? String(value) : null,
    };
  });

  if (rows.some((r) => !r.answer_value)) {
    return { error: "Answer all questions before submitting." };
  }

  const { error: answersError } = await supabase
    .from("branch_operation_answers")
    .upsert(rows, { onConflict: "cycle_id,branch_id,question_id" });
  if (answersError) return { error: answersError.message };

  const { error: progressError } = await supabase.from("branch_operation_progress").upsert(
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
