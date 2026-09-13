import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ParsedClaimRow } from "@/lib/parse-claims";
import type { ParsedClaimPartRow } from "@/lib/warranty-room/parse-claim-parts";
import type { ParsedScrappedPartRow } from "@/lib/warranty-room/parse-scrapped-parts";

const DB_CHUNK_SIZE = 500;

export type WarrantyRoomUploadKind = "claims_data" | "scrapped_parts";

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

/** Matches by claim_number alone (branch may be unknown for this sheet) and inserts into self_audit_scrapped_parts. */
export async function insertScrappedPartsChunk(
  batchId: string,
  parts: ParsedScrappedPartRow[]
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

    const { error } = await supabase.from("self_audit_scrapped_parts").insert(rows);
    if (error) return { error: error.message };
  }

  return { unmatched };
}

export async function finishWarrantyRoomBatch(
  batchId: string,
  totalRows: number,
  filename: string
): Promise<{ success?: string }> {
  return { success: `Processed ${totalRows} row(s) from "${filename}".` };
}
