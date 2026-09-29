import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ParsedClaimRow } from "@/lib/parse-claims";
import type { ParsedSupplierPartRow } from "@/lib/warranty-room/parse-supplier-parts";

const DB_CHUNK_SIZE = 500;

export type WarrantyRoomUploadKind = "claims_data" | "scrapped_parts" | "scrap_requests" | "supplier_parts";

export async function startWarrantyRoomBatch(
  officerId: string,
  kind: WarrantyRoomUploadKind,
  filename: string,
  rowCount: number
): Promise<{ batchId?: string; error?: string }> {
  if (!/\.(xlsx|csv)$/i.test(filename)) return { error: "Only .xlsx or .csv files are supported." };

  const supabase = await createClient();

  // Promote whatever's still pending into "presumed_scrapped" BEFORE this
  // upload's data lands - anything pending at this instant necessarily came
  // from an earlier claims dataset (see migration 0043), so this is exactly
  // the "next upload starts a new cycle" boundary the officer asked for. A
  // single bulk UPDATE keyed on scrap_requests (a few thousand rows), not
  // the 61k-row claims table, so no statement_timeout risk here.
  if (kind === "claims_data") {
    const { error: promoteError } = await supabase.rpc("promote_stale_scrap_requests");
    if (promoteError) return { error: `Could not roll over the previous scrap cycle: ${promoteError.message}` };
  }

  const { data: batch, error } = await supabase
    .from("self_audit_upload_batches")
    .insert({
      uploaded_by: officerId,
      source_filename: `[warranty-room:${kind}] ${filename}`,
      claim_month: new Date().toISOString().slice(0, 8) + "01",
      row_count: rowCount,
    })
    .select("id")
    .single();

  if (error || !batch) return { error: error?.message ?? "Could not create the upload batch." };
  return { batchId: batch.id };
}

/**
 * Upserts claim rows into the shared self_audit_claims table - same table
 * and same (branch_id, claim_number) upsert key self-audit's own claims
 * upload uses (src/lib/upload-claims.ts), so a claim uploaded here is the
 * exact same row self-audit/internal-audit would see. Deliberately does NOT
 * run any stale-claim deletion (unlike upload-claims.ts's finishUpload) -
 * Warranty Room only ever needs claims to exist/be current, never needs to
 * remove ones missing from a given export, so there's no reason to carry
 * that risk here at all.
 */
export async function upsertClaimsChunk(batchId: string, claims: ParsedClaimRow[]): Promise<{ error?: string }> {
  const supabase = await createClient();
  for (let i = 0; i < claims.length; i += DB_CHUNK_SIZE) {
    const chunk = claims.slice(i, i + DB_CHUNK_SIZE).map((c) => ({ ...c, upload_batch_id: batchId }));
    const { error } = await supabase.from("self_audit_claims").upsert(chunk, { onConflict: "branch_id,claim_number" });
    if (error) return { error: error.message };
  }
  return {};
}

/**
 * Groups Supplier Parts rows by branch into a self_audit_supplier_collections
 * row per branch - a physical hand-over/signature happens at one branch at a
 * time even when the uploaded sheet spans several. Re-uploading a sheet that
 * overlaps a branch's existing PENDING collection merges into it (updates
 * collection_date, upserts parts) instead of creating a duplicate collection -
 * a branch can easily end up uploaded twice by mistake. Once a collection is
 * signed or handed over it's closed for merging; a later upload for that
 * branch starts a fresh pending collection instead.
 *
 * The sheet itself only carries one "Main Part" per claim row, but a claim
 * can have several parts on file (self_audit_claim_parts, from the Part
 * Details sheet in All Claims Data). Each claim is expanded into one
 * collection-part row per actual part it has on file, so every part the
 * supplier wants is correctly reserved (and excluded from scrap requests) -
 * not just the one the sheet happened to name. A claim with no part-detail
 * rows on file yet falls back to the sheet's own Main Part/Main Part Name so
 * nothing is silently dropped. A part already sitting in a HANDED_OVER
 * collection for this branch is skipped entirely rather than re-reserved -
 * it's already been collected.
 */
export async function upsertSupplierPartsChunk(
  batchId: string,
  collectionDate: string | null,
  parts: ParsedSupplierPartRow[]
): Promise<{
  error?: string;
  unmatchedClaims?: number;
  alreadyHandedOver?: number;
  merged?: number;
  added?: number;
  mainPartOnly?: number;
}> {
  const supabase = await createClient();
  let unmatchedClaims = 0;
  let alreadyHandedOver = 0;
  let merged = 0;
  let added = 0;
  // A claim resolved fine but has no self_audit_claim_parts rows yet (its
  // Part Details haven't been uploaded/matched), so only the sheet's own
  // single Main Part got reserved for it - any other real parts on that
  // claim are NOT excluded from scrapping yet. Surfaced to the officer so
  // they know to re-upload this file once Part Details for that claim is on
  // file, rather than assuming the whole claim is safely reserved.
  let mainPartOnly = 0;

  const byBranch = new Map<string, ParsedSupplierPartRow[]>();
  parts.forEach((p) => {
    const list = byBranch.get(p.branch_id) ?? [];
    list.push(p);
    byBranch.set(p.branch_id, list);
  });

  for (const [branchId, branchParts] of byBranch) {
    const claimNumbers = [...new Set(branchParts.map((p) => p.claim_number))];
    const { data: claimMatches, error: claimErr } = await supabase
      .from("self_audit_claims")
      .select("id, claim_number")
      .eq("branch_id", branchId)
      .in("claim_number", claimNumbers);
    if (claimErr) return { error: claimErr.message };
    const claimIdByNumber = new Map((claimMatches ?? []).map((m) => [m.claim_number, m.id]));
    const claimIds = [...new Set(claimIdByNumber.values())];

    const [{ data: claimParts, error: claimPartsErr }, { data: handedOverParts, error: handedOverErr }] = await Promise.all([
      claimIds.length
        ? supabase.from("self_audit_claim_parts").select("claim_id, part_no, part_name, quantity").in("claim_id", claimIds)
        : Promise.resolve({ data: [], error: null }),
      claimIds.length
        ? supabase
            .from("self_audit_supplier_collection_parts")
            .select("claim_id, self_audit_supplier_collections!inner(status)")
            .in("claim_id", claimIds)
            .eq("self_audit_supplier_collections.status", "handed_over")
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (claimPartsErr) return { error: claimPartsErr.message };
    if (handedOverErr) return { error: handedOverErr.message };
    const handedOverClaimIds = new Set((handedOverParts ?? []).map((r) => r.claim_id).filter((id): id is string => !!id));

    const partsByClaimId = new Map<string, { part_no: string; part_name: string | null; quantity: number | null }[]>();
    (claimParts ?? []).forEach((p) => {
      const list = partsByClaimId.get(p.claim_id) ?? [];
      list.push(p);
      partsByClaimId.set(p.claim_id, list);
    });

    type PendingRow = {
      claim_id: string | null;
      work_order_no: string | null;
      vin: string | null;
      main_labor_name: string | null;
      part_no: string | null;
      part_name: string | null;
      quantity: number | null;
      planned_pickup_date: string | null;
      raw_row: Record<string, unknown>;
    };
    const pendingRows: PendingRow[] = [];

    branchParts.forEach((p) => {
      const claimId = claimIdByNumber.get(p.claim_number) ?? null;
      if (!claimId) unmatchedClaims += 1;
      if (claimId && handedOverClaimIds.has(claimId)) {
        alreadyHandedOver += 1;
        return;
      }
      const actualParts = claimId ? partsByClaimId.get(claimId) : undefined;
      if (claimId && (!actualParts || actualParts.length === 0)) mainPartOnly += 1;

      if (actualParts && actualParts.length > 0) {
        actualParts.forEach((ap) => {
          pendingRows.push({
            claim_id: claimId,
            work_order_no: p.work_order_no,
            vin: p.vin,
            main_labor_name: p.main_labor_name,
            part_no: ap.part_no,
            part_name: ap.part_name,
            quantity: ap.quantity,
            planned_pickup_date: p.planned_pickup_date,
            raw_row: p.raw_row,
          });
        });
      } else {
        pendingRows.push({
          claim_id: claimId,
          work_order_no: p.work_order_no,
          vin: p.vin,
          main_labor_name: p.main_labor_name,
          part_no: p.part_no,
          part_name: p.part_name,
          quantity: null,
          planned_pickup_date: p.planned_pickup_date,
          raw_row: p.raw_row,
        });
      }
    });

    // Nothing left to reserve for this branch (e.g. every claim in this
    // upload was already handed over) - skip creating/touching a collection
    // for it entirely rather than leaving behind an empty pending one.
    if (pendingRows.length === 0) continue;

    const { data: existing, error: existingErr } = await supabase
      .from("self_audit_supplier_collections")
      .select("id")
      .eq("branch_id", branchId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingErr) return { error: existingErr.message };

    let collectionId = existing?.id as string | undefined;
    if (collectionId) {
      const { error: updateErr } = await supabase
        .from("self_audit_supplier_collections")
        .update({ upload_batch_id: batchId, ...(collectionDate ? { collection_date: collectionDate } : {}) })
        .eq("id", collectionId);
      if (updateErr) return { error: updateErr.message };
    } else {
      const { data: created, error: createErr } = await supabase
        .from("self_audit_supplier_collections")
        .insert({ branch_id: branchId, upload_batch_id: batchId, collection_date: collectionDate, status: "pending" })
        .select("id")
        .single();
      if (createErr || !created) return { error: createErr?.message ?? "Could not create supplier collection." };
      collectionId = created.id;
    }

    const rows = pendingRows.map((r) => ({ ...r, collection_id: collectionId! }));
    const matchedRows = rows.filter((r) => r.claim_id && r.part_no);
    const unmatchedWithWorkOrder = rows.filter((r) => !r.claim_id && r.work_order_no && r.part_no);
    const restRows = rows.filter((r) => !matchedRows.includes(r) && !unmatchedWithWorkOrder.includes(r));

    const [existingMatched, existingUnmatched] = await Promise.all([
      matchedRows.length
        ? supabase
            .from("self_audit_supplier_collection_parts")
            .select("claim_id, part_no")
            .eq("collection_id", collectionId)
            .in("claim_id", [...new Set(matchedRows.map((r) => r.claim_id as string))])
        : Promise.resolve({ data: [] as { claim_id: string | null; part_no: string | null }[] }),
      unmatchedWithWorkOrder.length
        ? supabase
            .from("self_audit_supplier_collection_parts")
            .select("work_order_no, part_no")
            .eq("collection_id", collectionId)
            .in("work_order_no", [...new Set(unmatchedWithWorkOrder.map((r) => r.work_order_no as string))])
        : Promise.resolve({ data: [] as { work_order_no: string | null; part_no: string | null }[] }),
    ]);
    const existingMatchedKeys = new Set((existingMatched.data ?? []).map((r) => `${r.claim_id}:${r.part_no}`));
    const existingUnmatchedKeys = new Set((existingUnmatched.data ?? []).map((r) => `${r.work_order_no}:${r.part_no}`));
    matchedRows.forEach((r) => (existingMatchedKeys.has(`${r.claim_id}:${r.part_no}`) ? merged++ : added++));
    unmatchedWithWorkOrder.forEach((r) => (existingUnmatchedKeys.has(`${r.work_order_no}:${r.part_no}`) ? merged++ : added++));
    added += restRows.length;

    if (matchedRows.length > 0) {
      const { error } = await supabase
        .from("self_audit_supplier_collection_parts")
        .upsert(matchedRows, { onConflict: "collection_id,claim_id,part_no" });
      if (error) return { error: error.message };
    }
    if (unmatchedWithWorkOrder.length > 0) {
      const { error } = await supabase
        .from("self_audit_supplier_collection_parts")
        .upsert(unmatchedWithWorkOrder, { onConflict: "collection_id,work_order_no,part_no" });
      if (error) return { error: error.message };
    }
    if (restRows.length > 0) {
      const { error } = await supabase.from("self_audit_supplier_collection_parts").insert(restRows);
      if (error) return { error: error.message };
    }
  }

  return { unmatchedClaims, alreadyHandedOver, merged, added, mainPartOnly };
}

export async function finishWarrantyRoomBatch(
  batchId: string,
  totalRows: number,
  filename: string
): Promise<{ success?: string }> {
  return { success: `Processed ${totalRows} row(s) from "${filename}".` };
}
