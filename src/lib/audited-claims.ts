import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { selectAllRows } from "@/lib/supabase/paginate";

/**
 * Every claim ever assigned to a self-audit cycle OR sampled into an
 * internal audit, regardless of whether that audit was ever finished. A
 * claim audited by either workflow is never resampled by the other - see
 * src/app/admin/cycles/actions.ts (generateCycle) and
 * src/app/admin/internal-audit/actions.ts (startInternalAudit), the two
 * callers of this function.
 */
export async function getAuditedClaimIds(supabase: SupabaseClient<Database>): Promise<Set<string>> {
  const [selfAudited, internalAudited] = await Promise.all([
    selectAllRows<{ claim_id: string }>(async (from, to) =>
      supabase.from("self_audit_audit_assignments").select("claim_id").range(from, to)
    ),
    selectAllRows<{ claim_id: string }>(async (from, to) =>
      supabase.from("self_audit_internal_audit_claims").select("claim_id").range(from, to)
    ),
  ]);

  return new Set([...selfAudited.map((r) => r.claim_id), ...internalAudited.map((r) => r.claim_id)]);
}
