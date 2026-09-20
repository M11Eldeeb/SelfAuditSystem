import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ParsedClaimRow } from "@/lib/parse-claims";

const DB_CHUNK_SIZE = 500;

export async function startUploadBatch(
  officerId: string,
  claimMonth: string,
  filename: string,
  rowCount: number
): Promise<{ batchId?: string; error?: string }> {
  if (!claimMonth) return { error: "Select which month these claims belong to." };
  if (!/\.(xlsx|csv)$/i.test(filename)) return { error: "Only .xlsx or .csv files are supported." };

  const supabase = await createClient();

  const { data: batch, error } = await supabase
    .from("self_audit_upload_batches")
    .insert({
      uploaded_by: officerId,
      source_filename: filename,
      claim_month: `${claimMonth}-01`,
      row_count: rowCount,
    })
    .select("id")
    .single();

  if (error || !batch) return { error: error?.message ?? "Could not create the upload batch." };
  return { batchId: batch.id };
}

export async function upsertClaimsChunk(
  batchId: string,
  claims: ParsedClaimRow[]
): Promise<{ error?: string }> {
  const supabase = await createClient();

  for (let i = 0; i < claims.length; i += DB_CHUNK_SIZE) {
    const chunk = claims.slice(i, i + DB_CHUNK_SIZE).map((c) => ({ ...c, upload_batch_id: batchId }));
    const { error } = await supabase.from("self_audit_claims").upsert(chunk, { onConflict: "branch_id,claim_number" });
    if (error) return { error: error.message };
  }

  return {};
}

/**
 * The new sheet is the sole source of truth going forward, but only for the
 * branches it actually covers - removes claims left over from older upload
 * batches that no longer appear in this one, scoped strictly to those
 * branches. A branch with no rows in this upload keeps every existing claim
 * untouched, no matter how old, since a partial/single-branch upload
 * shouldn't be able to wipe out every other branch's data (this is exactly
 * what happened once: an old version of this scoped the cleanup globally
 * across ALL branches instead of just the ones in the new batch). Claims
 * already tied to an audit_assignment are left alone regardless.
 *
 * Computed via finish_claims_upload (migration 0030) rather than paginating
 * the batch's claims, every audit_assignment on file, and every non-batch
 * claim in JS (selectAllRows, 1000 rows/page) - for a 60k-row batch that was
 * 100+ sequential round trips just to compute a small stale-id set, on top
 * of upload_batch_id having no index at all on this table (also fixed in
 * that migration), which made every one of those pages a sequential scan.
 */
export async function finishUpload(
  batchId: string,
  totalClaims: number,
  filename: string
): Promise<{ success?: string; error?: string; deletedCount?: number }> {
  const supabase = await createClient();

  const { data: deletedCount, error } = await supabase.rpc("finish_claims_upload", { p_batch_id: batchId });
  if (error) return { error: error.message };

  return {
    success: `Processed ${totalClaims} claim(s) from "${filename}" (new claims added, existing ones updated)${
      deletedCount && deletedCount > 0
        ? `. Removed ${deletedCount} claim(s) no longer in this file for the branch(es) it covers.`
        : "."
    }`,
    deletedCount: deletedCount ?? 0,
  };
}
