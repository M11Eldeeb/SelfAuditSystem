import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadMainPartNames } from "@/lib/claim-main-part";
import { AuditClaimsList, type AuditClaimRow } from "./claims-list";

/**
 * Officers: the audit's claims as a list before the visit - the announced ones (sent to the branch) and the
 * unannounced ones (never shown to the branch) - each with its parts and the pre-visit check (serial number or
 * offline date), and an Excel download per list.
 */
export default async function InternalAuditClaimsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("officer");
  const { id: auditId } = await params;
  const supabase = await createClient();
  const [{ data: audit }, { data: rows }] = await Promise.all([
    supabase.from("self_audit_internal_audits").select("id, status, branch_id, audit_date").eq("id", auditId).maybeSingle(),
    supabase.from("self_audit_internal_audit_claims").select("*").eq("internal_audit_id", auditId).order("sort_order"),
  ]);
  if (!audit) notFound();
  const claimIds = (rows ?? []).map((r) => r.claim_id);
  const [{ data: partsQuestions }, { data: answers }] = await Promise.all([
    supabase.from("self_audit_audit_questions").select("id, text, options").eq("department", "parts").order("sort_order"),
    (rows ?? []).length
      ? supabase.from("self_audit_internal_audit_answers").select("internal_audit_claim_id, question_id, answer_value").in("internal_audit_claim_id", (rows ?? []).map((r) => r.id))
      : Promise.resolve({ data: [] as { internal_audit_claim_id: string; question_id: string; answer_value: string | null }[] }),
  ]);
  const partsIds = new Set((partsQuestions ?? []).map((q) => q.id));
  const answersOf = new Map<string, Record<string, string>>();
  for (const a of answers ?? []) {
    if (!partsIds.has(a.question_id) || a.answer_value == null) continue;
    answersOf.set(a.internal_audit_claim_id, { ...(answersOf.get(a.internal_audit_claim_id) ?? {}), [a.question_id]: a.answer_value });
  }
  const [{ data: claims }, { data: parts }, { data: branch }, mainParts] = await Promise.all([
    claimIds.length
      ? supabase
          .from("self_audit_claims")
          .select("id, claim_number, work_order_no, vin, vehicle_model, mileage, part_serial_number, part_production_date, repair_end_date, dealer_submit_date, labor_code, claim_amount, main_part_name")
          .in("id", claimIds)
      : Promise.resolve({ data: [] }),
    claimIds.length ? supabase.from("self_audit_claim_parts").select("claim_id, part_no, part_name, quantity").in("claim_id", claimIds) : Promise.resolve({ data: [] }),
    supabase.from("self_audit_branches").select("name").eq("id", audit.branch_id ?? "00000000-0000-0000-0000-000000000000").maybeSingle(),
    loadMainPartNames(supabase, claimIds),
  ]);
  const claimOf = new Map((claims ?? []).map((c) => [c.id, c]));
  const list: AuditClaimRow[] = (rows ?? []).map((r, index) => {
    const c = claimOf.get(r.claim_id);
    return {
      id: r.id,
      index,
      announced: r.announced,
      claimNumber: c?.claim_number ?? "—",
      workOrder: c?.work_order_no ?? null,
      vin: c?.vin ?? null,
      model: c?.vehicle_model ?? null,
      mileage: c?.mileage == null ? null : Number(c.mileage),
      mainPart: mainParts.get(r.claim_id) ?? c?.main_part_name ?? null,
      expectedSerial: c?.part_serial_number ?? null,
      expectedOffline: c?.part_production_date ?? null,
      repairEnd: c?.repair_end_date ?? null,
      submitted: c?.dealer_submit_date ?? null,
      laborCode: c?.labor_code ?? null,
      amount: c?.claim_amount == null ? null : Number(c.claim_amount),
      parts: (parts ?? []).filter((p) => p.claim_id === r.claim_id).map((p) => ({ partNo: p.part_no, name: p.part_name, qty: p.quantity == null ? null : Number(p.quantity) })),
      check: { method: r.check_method, serial: r.checked_serial, offlineDate: r.checked_offline_date, note: r.check_note },
      partsAnswers: answersOf.get(r.id) ?? {},
      checkedAt: r.checked_at,
      checkedBy: r.checked_by_name,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/admin/internal-audit/${auditId}`} className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to the audit
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">Claims list - {branch?.name ?? "Branch"}</h1>
        <p className="text-sm text-neutral-600">
          Check the parts before the visit: for each claim choose how the part is verified (serial number or offline date) and enter what you find. The unannounced list is
          for officers only - the branch never sees it.
        </p>
      </div>
      <AuditClaimsList auditId={auditId} rows={list} locked={audit.status === "finalized"} questions={(partsQuestions ?? []).map((q) => ({ id: q.id, text: q.text, options: Array.isArray(q.options) ? (q.options as string[]) : ["0", "25", "50", "75", "100"] }))} />
    </div>
  );
}
