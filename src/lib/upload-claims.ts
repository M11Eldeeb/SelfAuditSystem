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
    .from("upload_batches")
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
    const { error } = await supabase.from("claims").upsert(chunk, { onConflict: "branch_id,claim_number" });
    if (error) return { error: error.message };
  }

  return {};
}

/** Fetches every row for a query, paginating past PostgREST's 1000-row default page size. */
async function selectAllRows<T>(
  runQuery: (from: number, to: number) => Promise<{ data: T[] | null }>
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  const PAGE = 1000;
  for (;;) {
    const { data } = await runQuery(from, from + PAGE - 1);
    all.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return all;
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
 */
export async function finishUpload(
  batchId: string,
  totalClaims: number,
  filename: string
): Promise<{ success?: string; error?: string; deletedCount?: number }> {
  const supabase = await createClient();

  const batchClaimRows = await selectAllRows<{ branch_id: string }>(async (from, to) =>
    supabase.from("claims").select("branch_id").eq("upload_batch_id", batchId).range(from, to)
  );
  const batchBranchIds = [...new Set(batchClaimRows.map((r) => r.branch_id))];

  if (batchBranchIds.length === 0) {
    return { success: `Processed ${totalClaims} claim(s) from "${filename}".`, deletedCount: 0 };
  }

  const referencedRows = await selectAllRows<{ claim_id: string }>(async (from, to) =>
    supabase.from("audit_assignments").select("claim_id").range(from, to)
  );
  const referencedIds = new Set(referencedRows.map((r) => r.claim_id));

  const staleRows = await selectAllRows<{ id: string }>(async (from, to) =>
    supabase
      .from("claims")
      .select("id")
      .neq("upload_batch_id", batchId)
      .in("branch_id", batchBranchIds)
      .range(from, to)
  );
  const staleIds = staleRows.map((r) => r.id).filter((id) => !referencedIds.has(id));

  let deletedCount = 0;
  for (let i = 0; i < staleIds.length; i += DB_CHUNK_SIZE) {
    const chunk = staleIds.slice(i, i + DB_CHUNK_SIZE);
    const { error, count } = await supabase.from("claims").delete({ count: "exact" }).in("id", chunk);
    if (error) break; // don't fail the whole upload over cleanup
    deletedCount += count ?? chunk.length;
  }

  return {
    success: `Processed ${totalClaims} claim(s) from "${filename}" (new claims added, existing ones updated)${
      deletedCount > 0
        ? `. Removed ${deletedCount} claim(s) no longer in this file for the branch(es) it covers.`
        : "."
    }`,
    deletedCount,
  };
}
