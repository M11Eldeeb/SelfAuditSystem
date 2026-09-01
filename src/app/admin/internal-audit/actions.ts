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

type SampleCriteria = {
  branchId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  sampleSize: number;
  sampleMode: "flagged" | "random";
  maxPerPart: number | null;
};

function readCriteria(formData: FormData): SampleCriteria {
  const branchId = String(formData.get("branch_id") ?? "").trim() || null;
  const dateFrom = String(formData.get("date_from") ?? "").trim() || null;
  const dateTo = String(formData.get("date_to") ?? "").trim() || null;
  const sampleSize = Number(formData.get("sample_size"));
  const sampleMode = String(formData.get("sample_mode") ?? "random") === "flagged" ? "flagged" : "random";
  const maxPerPartRaw = Number(formData.get("max_per_part"));
  const maxPerPart = maxPerPartRaw > 0 ? maxPerPartRaw : null;
  return { branchId, dateFrom, dateTo, sampleSize, sampleMode, maxPerPart };
}

async function sampleEligibleClaims(
  supabase: Awaited<ReturnType<typeof createClient>>,
  { branchId, dateFrom, dateTo, sampleSize, sampleMode, maxPerPart }: SampleCriteria
) {
  let query = supabase.from("self_audit_claims").select("*").eq("has_parts", true);
  if (branchId) query = query.eq("branch_id", branchId);
  if (dateFrom) query = query.gte("dealer_submit_date", dateFrom);
  if (dateTo) query = query.lte("dealer_submit_date", dateTo);

  const { data: candidateClaims } = await query;
  const auditedClaimIds = await getAuditedClaimIds(supabase);
  const eligible = (candidateClaims ?? []).filter((c) => !auditedClaimIds.has(c.id));

  let ordered: ((typeof eligible)[number] & { _flag?: number })[];
  if (sampleMode === "flagged") {
    const workOrderCounts = buildWorkOrderCounts(eligible);
    ordered = shuffle(eligible) // randomize tie-breaks between equal-flag claims first
      .map((c) => ({ ...c, _flag: computeAuditFlag(c, workOrderCounts) }))
      .sort((a, b) => (b._flag ?? 0) - (a._flag ?? 0));
  } else {
    ordered = shuffle(eligible);
  }

  return selectWithPartCap(ordered, sampleSize, maxPerPart);
}

export type InternalAuditPreviewClaim = {
  id: string;
  claim_number: string;
  work_order_no: string | null;
  vin: string | null;
  branch_name: string;
  dealer_submit_date: string | null;
  labor_code: string | null;
  flag_score: number | null;
};

export type PreviewInternalAuditSampleState =
  | {
      error?: string;
      claims?: InternalAuditPreviewClaim[];
      branchId?: string | null;
      branchLabel?: string;
      dateFrom?: string | null;
      dateTo?: string | null;
      sampleSize?: number;
      sampleMode?: "flagged" | "random";
      maxPerPart?: number | null;
    }
  | undefined;

/**
 * Samples claims against the given criteria WITHOUT writing anything to the
 * database, so the officer can review (and download as a PDF) exactly which
 * claims would be picked before committing to an audit.
 */
export async function previewInternalAuditSample(
  _prev: PreviewInternalAuditSampleState,
  formData: FormData
): Promise<PreviewInternalAuditSampleState> {
  await requireRole("officer");
  const supabase = await createClient();
  const criteria = readCriteria(formData);

  if (!criteria.sampleSize || criteria.sampleSize < 1) {
    return { error: "Enter a sample size of at least 1." };
  }

  const sample = await sampleEligibleClaims(supabase, criteria);
  if (sample.length === 0) {
    return { error: "No eligible claims match these filters (or every matching claim has already been audited)." };
  }

  const { data: branches } = await supabase.from("self_audit_branches").select("id, name");
  const branchNameById = new Map((branches ?? []).map((b) => [b.id, b.name]));

  const claims: InternalAuditPreviewClaim[] = sample.map((c) => ({
    id: c.id,
    claim_number: c.claim_number,
    work_order_no: c.work_order_no,
    vin: c.vin,
    branch_name: branchNameById.get(c.branch_id) ?? "Unknown branch",
    dealer_submit_date: c.dealer_submit_date,
    labor_code: c.labor_code,
    flag_score: "_flag" in c ? ((c as { _flag: number })._flag ?? null) : null,
  }));

  return {
    claims,
    branchId: criteria.branchId,
    branchLabel: criteria.branchId ? (branchNameById.get(criteria.branchId) ?? "Unknown branch") : "All branches",
    dateFrom: criteria.dateFrom,
    dateTo: criteria.dateTo,
    sampleSize: criteria.sampleSize,
    sampleMode: criteria.sampleMode,
    maxPerPart: criteria.maxPerPart,
  };
}

export type StartInternalAuditState = { error?: string } | undefined;

/**
 * Commits the exact claim set the officer already previewed (passed as
 * repeated `claim_id` fields) rather than re-sampling - re-sampling here
 * would pick a different random set than what was just reviewed/downloaded.
 * Claims are re-checked against getAuditedClaimIds() in case one was claimed
 * by another audit in the time since the preview was generated.
 */
export async function startInternalAudit(
  _prev: StartInternalAuditState,
  formData: FormData
): Promise<StartInternalAuditState> {
  const officer = await requireRole("officer");
  const supabase = await createClient();
  const criteria = readCriteria(formData);

  const claimIds = formData.getAll("claim_id").map(String).filter(Boolean);
  if (claimIds.length === 0) {
    return { error: "Generate a sample first." };
  }

  const auditedClaimIds = await getAuditedClaimIds(supabase);
  const stillEligible = claimIds.filter((id) => !auditedClaimIds.has(id));
  if (stillEligible.length === 0) {
    return { error: "Every previewed claim has since been claimed by another audit - generate a new sample." };
  }

  const { data: audit, error: auditError } = await supabase
    .from("self_audit_internal_audits")
    .insert({
      branch_id: criteria.branchId,
      date_from: criteria.dateFrom,
      date_to: criteria.dateTo,
      sample_size: criteria.sampleSize,
      sample_mode: criteria.sampleMode,
      max_per_part: criteria.maxPerPart,
      auditor_id: officer.id,
      status: "in_progress",
    })
    .select("id")
    .single();

  if (auditError || !audit) {
    return { error: auditError?.message ?? "Could not create the internal audit." };
  }

  const { error: claimsError } = await supabase.from("self_audit_internal_audit_claims").insert(
    stillEligible.map((claimId, i) => ({
      internal_audit_id: audit.id,
      claim_id: claimId,
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
