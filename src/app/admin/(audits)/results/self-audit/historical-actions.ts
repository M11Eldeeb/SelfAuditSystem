"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { shiftMonth } from "@/lib/month";

export type CreateHistoricalState = { error?: string; success?: string } | undefined;

export async function createHistoricalSelfAudit(
  _prev: CreateHistoricalState,
  formData: FormData
): Promise<CreateHistoricalState> {
  const officer = await requireRole("officer");

  const branchId = String(formData.get("branch_id") ?? "");
  const periodMonthInput = String(formData.get("period_month") ?? "");
  const scorePctInput = String(formData.get("score_pct") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();
  const pdfPath = String(formData.get("pdf_path") ?? "");

  if (!branchId) return { error: "Select the branch." };
  if (!periodMonthInput) return { error: "Select the month." };
  const scorePct = Number(scorePctInput);
  if (!Number.isFinite(scorePct) || scorePct < 0 || scorePct > 100) {
    return { error: "Score must be a number between 0 and 100." };
  }

  const supabase = await createClient();

  const { error } = await supabase.from("self_audit_historical_audits").insert({
    audit_type: "self_audit",
    branch_id: branchId,
    period_month: shiftMonth(periodMonthInput, 0),
    score_pct: scorePct,
    pdf_path: pdfPath || null,
    notes: notes || null,
    uploaded_by: officer.id,
  });

  if (error) return { error: error.message };

  revalidatePath("/admin/results/self-audit");
  revalidatePath(`/admin/results/self-audit/${branchId}`);
  return { success: "Historical self-audit result added." };
}

export async function deleteHistoricalSelfAudit(id: string, branchId: string): Promise<{ error?: string }> {
  await requireRole("officer");

  const supabase = await createClient();
  const { error } = await supabase.from("self_audit_historical_audits").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/admin/results/self-audit");
  revalidatePath(`/admin/results/self-audit/${branchId}`);
  return {};
}
