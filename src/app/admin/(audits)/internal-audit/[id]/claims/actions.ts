"use server";

import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export type PartCheck = { method: "serial" | "offline" | null; serial: string | null; offlineDate: string | null; note: string | null };

/** Officers: the pre-visit parts check of one audit claim - how it is verified and what was found. */
export async function savePartCheck(internalClaimId: string, check: PartCheck): Promise<{ error?: string; at?: string; by?: string }> {
  const officer = await requireRole("officer");
  const admin = createAdminClient();
  const { data: row } = await admin.from("self_audit_internal_audit_claims").select("internal_audit_id").eq("id", internalClaimId).maybeSingle();
  if (!row) return { error: "Claim not found." };
  const { data: audit } = await admin.from("self_audit_internal_audits").select("status").eq("id", row.internal_audit_id).maybeSingle();
  if (audit?.status === "finalized") return { error: "This audit is finalized." };
  if (check.offlineDate && !/^\d{4}-\d{2}-\d{2}$/.test(check.offlineDate)) return { error: "Enter a valid date." };
  const at = new Date().toISOString();
  const by = officer.full_name ?? officer.email;
  const { error } = await admin
    .from("self_audit_internal_audit_claims")
    .update({
      check_method: check.method,
      checked_serial: check.serial?.trim().slice(0, 80) || null,
      checked_offline_date: check.offlineDate || null,
      check_note: check.note?.trim().slice(0, 1000) || null,
      checked_at: at,
      checked_by_name: by,
    })
    .eq("id", internalClaimId);
  return error ? { error: error.message } : { at, by };
}
