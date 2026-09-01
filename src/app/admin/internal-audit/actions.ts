"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getAuditedClaimIds } from "@/lib/audited-claims";
import { shuffle } from "@/lib/shuffle";
import { buildWorkOrderCounts, computeAuditFlag } from "@/lib/audit-flag";
import { selectWithPartCap } from "@/lib/internal-audit-sampling";
import { computeInternalAuditScores } from "@/lib/internal-audit-scoring";
import { DEPARTMENT_ORDER } from "@/lib/departments";
import type { DepartmentId } from "@/lib/supabase/types";

export type StartInternalAuditState =
  | { error?: string; success?: string; sampledCount?: number; requestedCount?: number }
  | undefined;

export async function startInternalAudit(
  _prev: StartInternalAuditState,
  formData: FormData
): Promise<StartInternalAuditState> {
  const officer = await requireRole("officer");
  const supabase = await createClient();

  const branchId = String(formData.get("branch_id") ?? "").trim() || null;
  const dateFrom = String(formData.get("date_from") ?? "").trim() || null;
  const dateTo = String(formData.get("date_to") ?? "").trim() || null;
  const sampleSize = Number(formData.get("sample_size"));
  const sampleMode = String(formData.get("sample_mode") ?? "random") === "flagged" ? "flagged" : "random";
  const maxPerPartRaw = Number(formData.get("max_per_part"));
  const maxPerPart = maxPerPartRaw > 0 ? maxPerPartRaw : null;

  if (!sampleSize || sampleSize < 1) {
    return { error: "Enter a sample size of at least 1." };
  }

  let query = supabase.from("self_audit_claims").select("*").eq("has_parts", true);
  if (branchId) query = query.eq("branch_id", branchId);
  if (dateFrom) query = query.gte("dealer_submit_date", dateFrom);
  if (dateTo) query = query.lte("dealer_submit_date", dateTo);

  const { data: candidateClaims } = await query;
  const auditedClaimIds = await getAuditedClaimIds(supabase);
  const eligible = (candidateClaims ?? []).filter((c) => !auditedClaimIds.has(c.id));

  if (eligible.length === 0) {
    return { error: "No eligible claims match these filters (or every matching claim has already been audited)." };
  }

  let ordered;
  if (sampleMode === "flagged") {
    const workOrderCounts = buildWorkOrderCounts(eligible);
    ordered = shuffle(eligible) // randomize tie-breaks between equal-flag claims first
      .map((c) => ({ ...c, _flag: computeAuditFlag(c, workOrderCounts) }))
      .sort((a, b) => b._flag - a._flag);
  } else {
    ordered = shuffle(eligible);
  }

  const sample = selectWithPartCap(ordered, sampleSize, maxPerPart);

  if (sample.length === 0) {
    return { error: "No claims could be sampled with these filters." };
  }

  const { data: audit, error: auditError } = await supabase
    .from("self_audit_internal_audits")
    .insert({
      branch_id: branchId,
      date_from: dateFrom,
      date_to: dateTo,
      sample_size: sampleSize,
      sample_mode: sampleMode,
      max_per_part: maxPerPart,
      auditor_id: officer.id,
      status: "in_progress",
    })
    .select("id")
    .single();

  if (auditError || !audit) {
    return { error: auditError?.message ?? "Could not create the internal audit." };
  }

  const { error: claimsError } = await supabase.from("self_audit_internal_audit_claims").insert(
    sample.map((c, i) => ({
      internal_audit_id: audit.id,
      claim_id: c.id,
      sort_order: i,
    }))
  );
  if (claimsError) {
    await supabase.from("self_audit_internal_audits").delete().eq("id", audit.id);
    return { error: claimsError.message };
  }

  revalidatePath("/admin/internal-audit");
  redirect(`/admin/internal-audit/${audit.id}?claim=0`);
}

export type SaveClaimAnswersState = { error?: string } | undefined;

export async function saveClaimAnswers(
  auditId: string,
  internalAuditClaimId: string,
  currentIndex: number,
  totalClaims: number,
  _prev: SaveClaimAnswersState,
  formData: FormData
): Promise<SaveClaimAnswersState> {
  await requireRole("officer");
  const supabase = await createClient();

  const { data: audit } = await supabase.from("self_audit_internal_audits").select("status").eq("id", auditId).single();
  if (!audit) return { error: "Internal audit not found." };
  if (audit.status === "finalized") return { error: "This audit has already been finalized." };

  const { data: questions } = await supabase
    .from("self_audit_audit_questions")
    .select("id")
    .in("scope", ["claim", "parts"])
    .order("sort_order");

  const answerRows = (questions ?? [])
    .map((q) => {
      const value = formData.get(`answer_${q.id}`);
      return {
        internal_audit_claim_id: internalAuditClaimId,
        question_id: q.id,
        answer_value: value ? String(value) : null,
      };
    })
    .filter((r) => r.answer_value !== null);

  if (answerRows.length > 0) {
    const { error } = await supabase
      .from("self_audit_internal_audit_answers")
      .upsert(answerRows, { onConflict: "internal_audit_claim_id,question_id" });
    if (error) return { error: error.message };
  }

  const noteText = formData.get("note");
  if (noteText !== null) {
    await supabase
      .from("self_audit_internal_audit_notes")
      .upsert(
        { internal_audit_claim_id: internalAuditClaimId, note_text: String(noteText).trim() || null },
        { onConflict: "internal_audit_claim_id" }
      );
  }

  revalidatePath(`/admin/internal-audit/${auditId}`);

  const nav = String(formData.get("nav") ?? "stay");
  if (nav === "next" && currentIndex < totalClaims - 1) {
    redirect(`/admin/internal-audit/${auditId}?claim=${currentIndex + 1}`);
  }
  if (nav === "prev" && currentIndex > 0) {
    redirect(`/admin/internal-audit/${auditId}?claim=${currentIndex - 1}`);
  }
  if (nav === "branch-ops") {
    redirect(`/admin/internal-audit/${auditId}/branch-ops`);
  }

  redirect(`/admin/internal-audit/${auditId}?claim=${currentIndex}`);
}

export type SaveBranchAnswersState = { error?: string } | undefined;

export async function saveBranchAnswers(
  auditId: string,
  _prev: SaveBranchAnswersState,
  formData: FormData
): Promise<SaveBranchAnswersState> {
  await requireRole("officer");
  const supabase = await createClient();

  const { data: audit } = await supabase.from("self_audit_internal_audits").select("status").eq("id", auditId).single();
  if (!audit) return { error: "Internal audit not found." };
  if (audit.status === "finalized") return { error: "This audit has already been finalized." };

  const { data: questions } = await supabase
    .from("self_audit_audit_questions")
    .select("id")
    .eq("scope", "branch")
    .order("sort_order");

  const answerRows = (questions ?? []).map((q) => {
    const value = formData.get(`answer_${q.id}`);
    return {
      internal_audit_id: auditId,
      question_id: q.id,
      answer_value: value ? String(value) : null,
    };
  });

  const { error } = await supabase
    .from("self_audit_internal_audit_branch_answers")
    .upsert(answerRows, { onConflict: "internal_audit_id,question_id" });
  if (error) return { error: error.message };

  revalidatePath(`/admin/internal-audit/${auditId}`);
  redirect(`/admin/internal-audit/${auditId}/finalize`);
}

export type FinalizeInternalAuditState = { error?: string } | undefined;

export async function finalizeInternalAudit(
  auditId: string,
  _prev: FinalizeInternalAuditState,
  formData: FormData
): Promise<FinalizeInternalAuditState> {
  await requireRole("officer");
  const supabase = await createClient();

  const { data: audit } = await supabase.from("self_audit_internal_audits").select("status").eq("id", auditId).single();
  if (!audit) return { error: "Internal audit not found." };
  if (audit.status === "finalized") return { error: "This audit has already been finalized." };

  const [{ data: questions }, { data: internalClaims }, { data: branchAnswers }] = await Promise.all([
    supabase.from("self_audit_audit_questions").select("*").in("scope", ["claim", "parts", "branch"]),
    supabase.from("self_audit_internal_audit_claims").select("id").eq("internal_audit_id", auditId),
    supabase.from("self_audit_internal_audit_branch_answers").select("question_id, answer_value").eq("internal_audit_id", auditId),
  ]);

  const internalClaimIds = (internalClaims ?? []).map((c) => c.id);
  const { data: claimAnswers } =
    internalClaimIds.length > 0
      ? await supabase
          .from("self_audit_internal_audit_answers")
          .select("question_id, answer_value")
          .in("internal_audit_claim_id", internalClaimIds)
      : { data: [] };

  const claimAnswersByQuestion = new Map<string, string[]>();
  (claimAnswers ?? []).forEach((a) => {
    const list = claimAnswersByQuestion.get(a.question_id) ?? [];
    if (a.answer_value != null) list.push(a.answer_value);
    claimAnswersByQuestion.set(a.question_id, list);
  });
  const branchAnswersByQuestion = new Map<string, string | null>(
    (branchAnswers ?? []).map((a) => [a.question_id, a.answer_value])
  );

  const { overallScore, perQuestionBreakdown } = computeInternalAuditScores(
    questions ?? [],
    claimAnswersByQuestion,
    branchAnswersByQuestion
  );

  const managerName = String(formData.get("manager_name") ?? "").trim() || null;
  const closingStatement = String(formData.get("closing_statement") ?? "").trim() || null;

  const remarkRows = DEPARTMENT_ORDER.map((dept) => {
    const text = String(formData.get(`remark_${dept}`) ?? "").trim();
    return { internal_audit_id: auditId, department_id: dept as DepartmentId, remark_text: text || null };
  }).filter((r) => r.remark_text !== null);

  if (remarkRows.length > 0) {
    const { error: remarksError } = await supabase
      .from("self_audit_internal_audit_department_remarks")
      .upsert(remarkRows, { onConflict: "internal_audit_id,department_id" });
    if (remarksError) return { error: remarksError.message };
  }

  const { error: updateError } = await supabase
    .from("self_audit_internal_audits")
    .update({
      status: "finalized",
      manager_name: managerName,
      closing_statement: closingStatement,
      score_pct: overallScore,
      per_question_breakdown: perQuestionBreakdown,
      finalized_at: new Date().toISOString(),
    })
    .eq("id", auditId);
  if (updateError) return { error: updateError.message };

  revalidatePath("/admin/internal-audit");
  redirect(`/admin/internal-audit/${auditId}/report`);
}

// Deletes an internal audit regardless of progress, same safety posture as
// deleteCycle (self-audit): the confirm dialog on the client is the safety check.
export async function deleteInternalAudit(auditId: string): Promise<{ error?: string }> {
  await requireRole("officer");
  const supabase = await createClient();

  const { error } = await supabase.from("self_audit_internal_audits").delete().eq("id", auditId);
  if (error) return { error: error.message };

  revalidatePath("/admin/internal-audit");
  return {};
}
