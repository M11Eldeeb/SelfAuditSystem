import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ParsedClaimRow } from "@/lib/parse-claims";
import type { ParsedClaimPartRow } from "@/lib/warranty-room/parse-claim-parts";
import type { ParsedScrappedPartRow } from "@/lib/warranty-room/parse-scrapped-parts";
import type { ParsedScrapRequestRow } from "@/lib/warranty-room/parse-scrap-requests";
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

/** Resolves each part row's claim by (branch_id, claim_number), then upserts into self_audit_claim_parts. */
export async function upsertClaimPartsChunk(
  batchId: string,
  parts: ParsedClaimPartRow[]
): Promise<{ error?: string; unmatched?: number }> {
  const supabase = await createClient();
  let unmatched = 0;

  for (let i = 0; i < parts.length; i += DB_CHUNK_SIZE) {
    const chunk = parts.slice(i, i + DB_CHUNK_SIZE);
    const claimNumbers = [...new Set(chunk.map((p) => p.claim_number))];
    const { data: matches, error: lookupError } = await supabase
      .from("self_audit_claims")
      .select("id, branch_id, claim_number")
      .in("claim_number", claimNumbers);
    if (lookupError) return { error: lookupError.message };

    const claimIdByKey = new Map<string, string>();
    (matches ?? []).forEach((m) => claimIdByKey.set(`${m.branch_id}:${m.claim_number}`, m.id));

    const rows = chunk
      .map((p) => {
        const claimId = claimIdByKey.get(`${p.branch_id}:${p.claim_number}`);
        if (!claimId) return null;
        return {
          claim_id: claimId,
          branch_id: p.branch_id,
          part_no: p.part_no,
          part_name: p.part_name,
          quantity: p.quantity,
          upload_batch_id: batchId,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    unmatched += chunk.length - rows.length;

    if (rows.length > 0) {
      const { error } = await supabase.from("self_audit_claim_parts").upsert(rows, { onConflict: "claim_id,part_no" });
      if (error) return { error: error.message };
    }
  }

  return { unmatched };
}

/**
 * Matches by claim_number alone (branch may be unknown for this sheet) and
 * upserts into self_audit_scrapped_parts - one record per part per claim
 * (falling back to one per part per work order when the claim can't be
 * matched - the sheet's own "Request" number is shared across many unrelated
 * claims, confirmed live, so it can't identify a single record), so
 * re-uploading the same or an overlapping file merges into what's already on
 * file instead of creating duplicate rows (migration 0024 adds the unique
 * indexes this relies on).
 */
export async function insertScrappedPartsChunk(
  batchId: string,
  parts: ParsedScrappedPartRow[]
): Promise<{ error?: string; unmatched?: number; merged?: number; added?: number }> {
  const supabase = await createClient();
  let unmatched = 0;
  let merged = 0;
  let added = 0;

  for (let i = 0; i < parts.length; i += DB_CHUNK_SIZE) {
    const chunk = parts.slice(i, i + DB_CHUNK_SIZE);
    const claimNumbers = [...new Set(chunk.map((p) => p.claim_number))];
    const { data: matches, error: lookupError } = await supabase
      .from("self_audit_claims")
      .select("id, branch_id, claim_number")
      .in("claim_number", claimNumbers);
    if (lookupError) return { error: lookupError.message };

    // Prefer a match in the row's own resolved branch when known; otherwise
    // take any claim with that number (claim numbers are effectively unique
    // in practice even though the DB constraint only enforces per-branch).
    const claimsByNumber = new Map<string, { id: string; branch_id: string }[]>();
    (matches ?? []).forEach((m) => {
      const list = claimsByNumber.get(m.claim_number) ?? [];
      list.push({ id: m.id, branch_id: m.branch_id });
      claimsByNumber.set(m.claim_number, list);
    });

    const rows = chunk.map((p) => {
      const candidates = claimsByNumber.get(p.claim_number) ?? [];
      const match = (p.branch_id && candidates.find((c) => c.branch_id === p.branch_id)) || candidates[0];
      if (!match) unmatched += 1;
      return {
        claim_id: match?.id ?? null,
        external_request_no: p.external_request_no,
        work_order_no: p.work_order_no,
        vin: p.vin,
        part_no: p.part_no,
        part_name: p.part_name,
        quantity: p.quantity,
        main_labor_code: p.main_labor_code,
        main_labor_name: p.main_labor_name,
        settlement_date: p.settlement_date,
        holding_period_days: p.holding_period_days,
        upload_batch_id: batchId,
      };
    });

    const matchedRows = rows.filter((r) => r.claim_id && r.part_no);
    const unmatchedWithWorkOrder = rows.filter((r) => !r.claim_id && r.work_order_no && r.part_no);
    const restRows = rows.filter((r) => !matchedRows.includes(r) && !unmatchedWithWorkOrder.includes(r));

    const [existingMatched, existingUnmatched] = await Promise.all([
      matchedRows.length
        ? supabase
            .from("self_audit_scrapped_parts")
            .select("claim_id, part_no")
            .in(
              "claim_id",
              [...new Set(matchedRows.map((r) => r.claim_id as string))]
            )
        : Promise.resolve({ data: [] as { claim_id: string | null; part_no: string | null }[] }),
      unmatchedWithWorkOrder.length
        ? supabase
            .from("self_audit_scrapped_parts")
            .select("work_order_no, part_no")
            .in(
              "work_order_no",
              [...new Set(unmatchedWithWorkOrder.map((r) => r.work_order_no as string))]
            )
        : Promise.resolve({ data: [] as { work_order_no: string | null; part_no: string | null }[] }),
    ]);
    const existingMatchedKeys = new Set((existingMatched.data ?? []).map((r) => `${r.claim_id}:${r.part_no}`));
    const existingUnmatchedKeys = new Set((existingUnmatched.data ?? []).map((r) => `${r.work_order_no}:${r.part_no}`));
    matchedRows.forEach((r) => (existingMatchedKeys.has(`${r.claim_id}:${r.part_no}`) ? merged++ : added++));
    unmatchedWithWorkOrder.forEach((r) =>
      existingUnmatchedKeys.has(`${r.work_order_no}:${r.part_no}`) ? merged++ : added++
    );
    added += restRows.length;

    if (matchedRows.length > 0) {
      const { error } = await supabase
        .from("self_audit_scrapped_parts")
        .upsert(matchedRows, { onConflict: "claim_id,part_no" });
      if (error) return { error: error.message };
    }
    if (unmatchedWithWorkOrder.length > 0) {
      const { error } = await supabase
        .from("self_audit_scrapped_parts")
        .upsert(unmatchedWithWorkOrder, { onConflict: "work_order_no,part_no" });
      if (error) return { error: error.message };
    }
    if (restRows.length > 0) {
      const { error } = await supabase.from("self_audit_scrapped_parts").insert(restRows);
      if (error) return { error: error.message };
    }
  }

  return { unmatched, merged, added };
}

/**
 * For each claim in "Parts should be scraped": looks up the claim's full
 * part list from self_audit_claim_parts, subtracts any part already
 * reserved for the supplier (present in self_audit_supplier_collection_parts
 * for that claim, regardless of that collection's status - a part earmarked
 * for the supplier is never scrapped), and only creates/updates a scrap
 * request if at least one part remains. Upserting on claim_id means
 * re-uploading the same claim updates its part list without resetting its
 * review status (status isn't part of the upserted columns, so an
 * in-progress request stays exactly where it was).
 */
export async function upsertScrapRequestsChunk(
  batchId: string,
  requests: ParsedScrapRequestRow[]
): Promise<{ error?: string; skippedNoParts?: number; unmatchedClaims?: number }> {
  const supabase = await createClient();
  let skippedNoParts = 0;
  let unmatchedClaims = 0;

  for (let i = 0; i < requests.length; i += DB_CHUNK_SIZE) {
    const chunk = requests.slice(i, i + DB_CHUNK_SIZE);
    const claimNumbers = [...new Set(chunk.map((r) => r.claim_number))];

    const { data: claimMatches, error: claimErr } = await supabase
      .from("self_audit_claims")
      .select("id, branch_id, claim_number, main_part_name, raw_row")
      .in("claim_number", claimNumbers);
    if (claimErr) return { error: claimErr.message };
    const claimIdByKey = new Map((claimMatches ?? []).map((m) => [`${m.branch_id}:${m.claim_number}`, m.id]));
    const claimIds = [...new Set(claimIdByKey.values())];

    // Fallback part for a claim with no self_audit_claim_parts rows at all -
    // older exports' "Part Details" sheet didn't cover every claim that has
    // a part on the main sheet (has_parts=true came from that main sheet's
    // own "Main Part" column, independent of Part Details coverage), so a
    // real number of legitimately-has-a-part claims have nothing in
    // self_audit_claim_parts. Without this, upsertScrapRequestsChunk skipped
    // them entirely - a claim correctly listed on "Parts should be scraped"
    // could never get a scrap request, leaving it stuck in Do Not Scrap
    // forever. Mirrors the same main-part fallback upsertSupplierPartsChunk
    // already uses when a claim has no part-detail rows.
    const mainPartNoByClaimId = new Map<string, string>();
    (claimMatches ?? []).forEach((m) => {
      const rawRow = (m.raw_row ?? {}) as Record<string, unknown>;
      const key = Object.keys(rawRow).find((h) =>
        ["main part", "part number", "part no", "part code"].includes(
          h.trim().toLowerCase().replace(/\s+/g, " ")
        )
      );
      const value = key ? String(rawRow[key] ?? "").trim() : "";
      if (value) mainPartNoByClaimId.set(m.id, value);
    });
    const mainPartNameByClaimId = new Map(
      (claimMatches ?? []).filter((m) => m.main_part_name).map((m) => [m.id, m.main_part_name as string])
    );

    const [{ data: allParts, error: partsErr }, { data: reserved, error: reservedErr }] = await Promise.all([
      claimIds.length
        ? supabase.from("self_audit_claim_parts").select("claim_id, part_no, part_name, quantity").in("claim_id", claimIds)
        : Promise.resolve({ data: [], error: null }),
      claimIds.length
        ? supabase.from("self_audit_supplier_collection_parts").select("claim_id, part_no").in("claim_id", claimIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (partsErr) return { error: partsErr.message };
    if (reservedErr) return { error: reservedErr.message };

    const partsByClaimId = new Map<string, { part_no: string; part_name: string | null; quantity: number | null }[]>();
    (allParts ?? []).forEach((p) => {
      const list = partsByClaimId.get(p.claim_id) ?? [];
      list.push(p);
      partsByClaimId.set(p.claim_id, list);
    });
    const reservedByClaimId = new Map<string, Set<string>>();
    (reserved ?? []).forEach((r) => {
      if (!r.part_no || !r.claim_id) return;
      const set = reservedByClaimId.get(r.claim_id) ?? new Set<string>();
      set.add(r.part_no);
      reservedByClaimId.set(r.claim_id, set);
    });

    const requestRows: {
      claim_id: string;
      branch_id: string;
      work_order_no: string | null;
      main_labor_code: string | null;
      main_labor_name: string | null;
      settlement_date: string | null;
      holding_period_days: number | null;
      upload_batch_id: string;
    }[] = [];
    const remainingPartsByClaimId = new Map<string, { part_no: string; part_name: string | null; quantity: number | null }[]>();

    chunk.forEach((r) => {
      const claimId = claimIdByKey.get(`${r.branch_id}:${r.claim_number}`);
      if (!claimId) {
        unmatchedClaims += 1;
        return;
      }
      let claimParts = partsByClaimId.get(claimId) ?? [];
      if (claimParts.length === 0) {
        const fallbackPartNo = mainPartNoByClaimId.get(claimId);
        if (!fallbackPartNo) {
          skippedNoParts += 1;
          return;
        }
        claimParts = [
          { part_no: fallbackPartNo, part_name: mainPartNameByClaimId.get(claimId) ?? null, quantity: null },
        ];
      }
      const reservedSet = reservedByClaimId.get(claimId) ?? new Set<string>();
      const remaining = claimParts.filter((p) => !reservedSet.has(p.part_no));
      if (remaining.length === 0) {
        skippedNoParts += 1;
        return;
      }

      requestRows.push({
        claim_id: claimId,
        branch_id: r.branch_id,
        work_order_no: r.work_order_no,
        main_labor_code: r.main_labor_code,
        main_labor_name: r.main_labor_name,
        settlement_date: r.settlement_date,
        holding_period_days: r.holding_period_days,
        upload_batch_id: batchId,
      });
      remainingPartsByClaimId.set(claimId, remaining);
    });

    if (requestRows.length === 0) continue;

    const { data: upsertedRequests, error: upsertErr } = await supabase
      .from("self_audit_scrap_requests")
      .upsert(requestRows, { onConflict: "claim_id" })
      .select("id, claim_id");
    if (upsertErr) return { error: upsertErr.message };

    const requestIdByClaimId = new Map((upsertedRequests ?? []).map((r) => [r.claim_id, r.id]));
    const requestIds = [...requestIdByClaimId.values()];

    if (requestIds.length > 0) {
      const { error: deleteErr } = await supabase.from("self_audit_scrap_request_parts").delete().in("scrap_request_id", requestIds);
      if (deleteErr) return { error: deleteErr.message };
    }

    const partRows: { scrap_request_id: string; part_no: string; part_name: string | null; quantity: number | null }[] = [];
    remainingPartsByClaimId.forEach((parts, claimId) => {
      const requestId = requestIdByClaimId.get(claimId);
      if (!requestId) return;
      parts.forEach((p) => partRows.push({ scrap_request_id: requestId, part_no: p.part_no, part_name: p.part_name, quantity: p.quantity }));
    });
    if (partRows.length > 0) {
      const { error: insertErr } = await supabase.from("self_audit_scrap_request_parts").insert(partRows);
      if (insertErr) return { error: insertErr.message };
    }
  }

  return { skippedNoParts, unmatchedClaims };
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
): Promise<{ error?: string; unmatchedClaims?: number; alreadyHandedOver?: number; merged?: number; added?: number }> {
  const supabase = await createClient();
  let unmatchedClaims = 0;
  let alreadyHandedOver = 0;
  let merged = 0;
  let added = 0;

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

  return { unmatchedClaims, alreadyHandedOver, merged, added };
}

export async function finishWarrantyRoomBatch(
  batchId: string,
  totalRows: number,
  filename: string
): Promise<{ success?: string }> {
  return { success: `Processed ${totalRows} row(s) from "${filename}".` };
}
