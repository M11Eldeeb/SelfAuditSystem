"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Removes just the finalized result record from view - the underlying
// assignments, answers and photos are untouched, same safety posture as
// deleteInternalAudit (confirm dialog on the client is the safety check).
export async function deleteAuditResult(cycleId: string, branchId: string): Promise<{ error?: string }> {
  await requireRole("officer");
  const supabase = await createClient();

  const { error } = await supabase
    .from("self_audit_audit_results")
    .delete()
    .eq("cycle_id", cycleId)
    .eq("branch_id", branchId);
  if (error) return { error: error.message };

  revalidatePath(`/admin/results/self-audit/${cycleId}`);
  revalidatePath("/admin/results/self-audit");
  return {};
}
