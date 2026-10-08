"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type LookupPart = { claimPartId: string | null; partNo: string | null; partName: string | null; quantity: number | null };

export type LookupClaim = {
  claimId: string;
  claimNumber: string;
  branchId: string;
  branchName: string;
  workOrderNo: string | null;
  vin: string | null;
  vehicleModel: string | null;
  laborName: string | null;
  claimAmount: number | null;
  repairEndDate: string | null;
  parts: LookupPart[];
};

/**
 * Finds claims by claim number (one per line / comma / space), optionally
 * limited to one branch, with every part on each claim. Parts come from the
 * warranty room claim-parts upload; a claim with none there falls back to
 * its main part from the claims export.
 */
export async function lookupClaims(
  input: string,
  branchId: string | null
): Promise<{ claims: LookupClaim[]; notFound: string[]; error?: string }> {
  await requireRole("officer");
  const supabase = await createClient();

  const numbers = [...new Set(input.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 200);
  if (numbers.length === 0) return { claims: [], notFound: [] };

  let q = supabase
    .from("self_audit_claims")
    .select('id, claim_number, branch_id, work_order_no, vin, vehicle_model, claim_amount, repair_end_date, main_part_name, labor_name:raw_row->>"Main Labor Name", main_part:raw_row->>"Main Part"' as string)
    .in("claim_number", numbers);
  if (branchId) q = q.eq("branch_id", branchId);
  const { data, error } = await q;
  if (error) return { claims: [], notFound: numbers, error: error.message };

  const rows = (data ?? []) as unknown as {
    id: string;
    claim_number: string;
    branch_id: string;
    work_order_no: string | null;
    vin: string | null;
    vehicle_model: string | null;
    claim_amount: number | null;
    repair_end_date: string | null;
    main_part_name: string | null;
    labor_name: string | null;
    main_part: string | null;
  }[];

  const ids = rows.map((r) => r.id);
  const [{ data: parts }, { data: branches }] = await Promise.all([
    ids.length
      ? supabase.from("self_audit_claim_parts").select("id, claim_id, part_no, part_name, quantity").in("claim_id", ids)
      : Promise.resolve({ data: [] as { id: string; claim_id: string; part_no: string; part_name: string | null; quantity: number | null }[] }),
    supabase.from("self_audit_branches").select("id, name"),
  ]);
  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));

  const claims: LookupClaim[] = rows.map((r) => {
    const own = (parts ?? []).filter((p) => p.claim_id === r.id);
    return {
      claimId: r.id,
      claimNumber: r.claim_number,
      branchId: r.branch_id,
      branchName: branchName.get(r.branch_id) ?? "",
      workOrderNo: r.work_order_no,
      vin: r.vin,
      vehicleModel: r.vehicle_model,
      laborName: r.labor_name,
      claimAmount: r.claim_amount,
      repairEndDate: r.repair_end_date,
      parts: own.length
        ? own.map((p) => ({ claimPartId: p.id, partNo: p.part_no, partName: p.part_name, quantity: p.quantity }))
        : r.main_part || r.main_part_name
          ? [{ claimPartId: null, partNo: r.main_part, partName: r.main_part_name, quantity: 1 }]
          : [],
    };
  });

  const found = new Set(rows.map((r) => r.claim_number.toUpperCase()));
  return { claims, notFound: numbers.filter((n) => !found.has(n)) };
}

export type NewItem = {
  claimId: string;
  branchId: string;
  claimNumber: string;
  workOrderNo: string | null;
  vin: string | null;
  claimAmount: number | null;
  partNo: string | null;
  partName: string | null;
  quantity: number | null;
};

/** Creates one request per branch for all selected parts, in one go. */
export async function createPartReturns(items: NewItem[], note: string): Promise<{ error?: string; created?: number }> {
  const officer = await requireRole("officer");
  if (items.length === 0) return { error: "Select at least one part." };
  const supabase = await createClient();

  const byBranch = new Map<string, NewItem[]>();
  for (const it of items) byBranch.set(it.branchId, [...(byBranch.get(it.branchId) ?? []), it]);

  for (const [branchId, list] of byBranch) {
    const { data: req, error } = await supabase
      .from("self_audit_part_returns")
      .insert({ branch_id: branchId, officer_note: note.trim() || null, created_by: officer.id })
      .select("id")
      .single();
    if (error || !req) return { error: error?.message ?? "Could not create the request." };

    const { error: itemsError } = await supabase.from("self_audit_part_return_items").insert(
      list.map((it) => ({
        request_id: req.id,
        claim_id: it.claimId,
        claim_number: it.claimNumber,
        work_order_no: it.workOrderNo,
        vin: it.vin,
        claim_amount: it.claimAmount,
        part_no: it.partNo,
        part_name: it.partName,
        quantity: it.quantity,
      }))
    );
    if (itemsError) {
      await supabase.from("self_audit_part_returns").delete().eq("id", req.id);
      return { error: itemsError.message };
    }
  }

  revalidatePath("/admin/part-returns");
  return { created: byBranch.size };
}

/** Deduction tracker for a missing part: to be deducted -> deducted, or waived (none). */
export async function setDeduction(itemId: string, status: "none" | "pending" | "deducted"): Promise<{ error?: string }> {
  const officer = await requireRole("officer");
  const supabase = await createClient();
  const { error } = await supabase
    .from("self_audit_part_return_items")
    .update({
      deduction_status: status,
      deducted_by: status === "deducted" ? officer.id : null,
      deducted_at: status === "deducted" ? new Date().toISOString() : null,
    })
    .eq("id", itemId);
  if (error) return { error: error.message };
  revalidatePath("/admin/part-returns", "layout");
  return {};
}

/** Officer received the parts and forwarded them to the manufacturer. */
export async function closePartReturn(
  requestId: string,
  form: { invoiceNo: string; shippingCompany: string; oemWaybill: string }
): Promise<{ error?: string }> {
  const officer = await requireRole("officer");
  const invoiceNo = form.invoiceNo.trim();
  const shippingCompany = form.shippingCompany.trim();
  const oemWaybill = form.oemWaybill.trim();
  if (!invoiceNo || !shippingCompany || !oemWaybill) return { error: "Invoice number, shipping company and waybill are all required." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("self_audit_part_returns")
    .update({
      status: "closed",
      invoice_no: invoiceNo,
      shipping_company: shippingCompany,
      oem_waybill: oemWaybill,
      closed_by: officer.id,
      closed_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("status", "dispatched");
  if (error) return { error: error.message };
  revalidatePath("/admin/part-returns", "layout");
  return {};
}

/** Withdraw a request the branch hasn't acted on yet. */
export async function deletePartReturn(requestId: string): Promise<{ error?: string }> {
  await requireRole("officer");
  const supabase = await createClient();
  const { error } = await supabase.from("self_audit_part_returns").delete().eq("id", requestId).eq("status", "open");
  if (error) return { error: error.message };
  revalidatePath("/admin/part-returns", "layout");
  return {};
}
