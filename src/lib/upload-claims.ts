import "server-only";
import { createClient } from "@/lib/supabase/server";
import { readSpreadsheet } from "@/lib/read-spreadsheet";
import { parseClaimRows, type SkippedRow } from "@/lib/parse-claims";

export type UploadResult = {
  error?: string;
  success?: string;
  inserted?: number;
  skipped?: SkippedRow[];
};

const CHUNK_SIZE = 500;

export async function processClaimsUpload(officerId: string, formData: FormData): Promise<UploadResult> {
  const file = formData.get("file");
  const claimMonth = String(formData.get("claim_month") ?? "");

  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a claims file to upload." };
  }
  if (!claimMonth) {
    return { error: "Select which month these claims belong to." };
  }
  if (!/\.(xlsx|csv)$/i.test(file.name)) {
    return { error: "Only .xlsx or .csv files are supported." };
  }

  const supabase = await createClient();

  const { data: branches } = await supabase.from("branches").select("id, name, code");
  const branchLookup = new Map<string, string>();
  (branches ?? []).forEach((b) => {
    branchLookup.set(b.code.toLowerCase(), b.id);
    branchLookup.set(b.name.toLowerCase(), b.id);
  });

  if (branchLookup.size === 0) {
    return { error: "Add at least one branch before uploading claims." };
  }

  let headers: string[];
  let rows: unknown[][];
  try {
    const buffer = await file.arrayBuffer();
    ({ headers, rows } = await readSpreadsheet(buffer, file.name));
  } catch {
    return { error: "Could not read that file. Make sure it's a valid .xlsx or .csv export." };
  }

  let claims;
  let skipped: SkippedRow[];
  try {
    ({ claims, skipped } = parseClaimRows(headers, rows, branchLookup));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not parse the file." };
  }

  if (claims.length === 0) {
    return { error: "No valid claim rows found in that file.", skipped };
  }

  const { data: batch, error: batchError } = await supabase
    .from("upload_batches")
    .insert({
      uploaded_by: officerId,
      source_filename: file.name,
      claim_month: `${claimMonth}-01`,
      row_count: claims.length,
    })
    .select("id")
    .single();

  if (batchError || !batch) {
    return { error: batchError?.message ?? "Could not create the upload batch." };
  }

  // Upsert on (branch_id, claim_number): the monthly export is cumulative
  // (every prior claim plus new ones), so this updates existing claims in
  // place instead of duplicating them. Deleting old rows outright isn't
  // safe once a claim is referenced by an audit_assignment - upsert keeps
  // the same row/id, so generated cycles and in-progress submissions never
  // break.
  for (let i = 0; i < claims.length; i += CHUNK_SIZE) {
    const chunk = claims.slice(i, i + CHUNK_SIZE).map((c) => ({ ...c, upload_batch_id: batch.id }));
    const { error: upsertError } = await supabase
      .from("claims")
      .upsert(chunk, { onConflict: "branch_id,claim_number" });
    if (upsertError) {
      return {
        error: `Processed ${i} of ${claims.length} rows before failing: ${upsertError.message}`,
        skipped,
      };
    }
  }

  return {
    success: `Processed ${claims.length} claim(s) from "${file.name}" (new claims added, existing ones updated).`,
    inserted: claims.length,
    skipped,
  };
}
