"use server";

import { requireRole, requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The claims an upcoming internal audit of the caller's own branch will
 * cover, for the downloadable sheet. The database function only answers for
 * an in-progress audit of the caller's branch, so a made-up id returns nothing.
 */
export async function getUpcomingAuditSample(auditId: string) {
  await requireViewer("branch_admin");
  if (!UUID.test(auditId)) return { error: "Audit not found." as const, rows: [] };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_upcoming_internal_audit_claims", { p_audit_id: auditId });
  if (error) return { error: "Could not load the claim list - please try again." as const, rows: [] };
  if (!data || data.length === 0) return { error: "This audit's claim list is not available." as const, rows: [] };
  return { rows: data };
}
