"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Branch closes a part return request: every part is either dispatched
 * (shipped under the waybill) or missing (with a justification - which puts
 * the claim on the officer's deduction tracker). The request then shows as
 * "Dispatched to warranty team".
 *
 * Branch admins only have read access to these tables, so the write goes
 * through the service-role client - after checking here that the request
 * belongs to the caller's branch and is still open, and touching only the
 * branch's own fields.
 */
export async function closeBranchPartReturn(
  requestId: string,
  form: { waybill: string; missing: { itemId: string; reason: string }[] }
): Promise<{ error?: string }> {
  const user = await requireRole("branch_admin");
  const supabase = await createClient();

  // RLS-scoped read: returns nothing unless it's this branch's request.
  const { data: request } = await supabase
    .from("self_audit_part_returns")
    .select("id, branch_id, status")
    .eq("id", requestId)
    .maybeSingle();
  if (!request || request.branch_id !== user.branch_id) return { error: "Request not found." };
  if (request.status !== "open") return { error: "This request is already closed." };

  const { data: items } = await supabase.from("self_audit_part_return_items").select("id").eq("request_id", requestId);
  const itemIds = new Set((items ?? []).map((i) => i.id));
  const missing = form.missing.filter((m) => itemIds.has(m.itemId));
  if (missing.some((m) => !m.reason.trim())) return { error: "Write a justification for every missing part." };

  const waybill = form.waybill.trim();
  const missingIds = new Set(missing.map((m) => m.itemId));
  const dispatchedIds = [...itemIds].filter((id) => !missingIds.has(id));
  if (dispatchedIds.length > 0 && !waybill) return { error: "Enter the waybill number for the parts you're sending." };

  const admin = createAdminClient();
  if (dispatchedIds.length) {
    const { error } = await admin
      .from("self_audit_part_return_items")
      .update({ status: "dispatched", missing_reason: null, deduction_status: "none" })
      .in("id", dispatchedIds);
    if (error) return { error: error.message };
  }
  for (const m of missing) {
    const { error } = await admin
      .from("self_audit_part_return_items")
      .update({ status: "missing", missing_reason: m.reason.trim(), deduction_status: "pending" })
      .eq("id", m.itemId);
    if (error) return { error: error.message };
  }

  const { error } = await admin
    .from("self_audit_part_returns")
    .update({
      status: "dispatched",
      branch_waybill: waybill || null,
      branch_closed_by: user.id,
      branch_closed_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("status", "open");
  if (error) return { error: error.message };

  revalidatePath("/audit/part-returns", "layout");
  revalidatePath("/admin/part-returns", "layout");
  return {};
}
