"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readWorkbookSheets } from "@/lib/warranty-room/read-workbook";
import { parseScrappedParts, type SkippedScrappedRow } from "@/lib/warranty-room/parse-scrapped-parts";
import { postJsonWithRetry, supabaseWithRetry, runChunksWithConcurrency } from "@/lib/warranty-room/client-upload";
import { createClient } from "@/lib/supabase/client";
import { UploadProgressBar } from "@/components/upload-progress-bar";

type Branch = { id: string; name: string; code: string };

type UploadState =
  | { error?: string; success?: string; skipped?: SkippedScrappedRow[]; unmatched?: number; merged?: number; added?: number }
  | undefined;

// Each chunk calls the upsert_scrapped_parts_chunk RPC directly from the
// browser instead of proxying through a Vercel API route - this sheet used
// to be the slowest upload in the app for two compounding reasons, both
// fixed here. First, matching each row to a claim, checking whether it
// already existed, and upserting it used to take ~5 sequential database
// round trips per chunk (a claim lookup, two existing-key lookups, then up
// to 3 separate upsert/insert statements) - upsert_scrapped_parts_chunk
// does the same matching/diffing/upserting in ONE round trip via a single
// SQL statement per branch (see its migration for the full reasoning).
// Second, going straight to Supabase removes the fixed per-HTTP-request
// overhead that dominated even the simpler claims upload (a Vercel function
// invocation plus a fresh auth.getUser() round trip on every single
// request) and Vercel's 4.5MB request-body cap, which no longer applies -
// letting the chunk size grow from 300 to 2,000 rows. EXPLAIN ANALYZE
// against this project's real data confirms the RPC itself easily handles
// 2,000 rows in ~2.8s, far inside the 2-minute statement_timeout on this
// project's Postgres. Chunks still run one at a time, not concurrently -
// concurrency was tried and reverted previously after live testing showed
// this project's Postgres compute (confirmed free-tier) can't absorb
// several of these queries at once without individual requests degrading
// sharply; that's a database-side limit, unrelated to which layer issues
// the request, so it still applies here. Every chunk still retries on
// failure - the RPC is idempotent (upserts on natural keys), so re-sending
// one after a transient failure is always safe.
const NETWORK_CHUNK_SIZE = 2000;
const CONCURRENCY = 1;
const DETAILS_SHEET = "RepPartToDestroyDetailsView";

/** Uploads "Parts Already Scraped" - reference data only, feeds the do-not-scrap report and (later) sampling exclusion. */
export function ScrappedPartsUploadForm({ branches, onUploaded }: { branches: Branch[]; onUploaded?: () => void }) {
  const [state, setState] = useState<UploadState>(undefined);
  const [progress, setProgress] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState(undefined);
    setPending(true);

    try {
      const formData = new FormData(e.currentTarget);
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) {
        setState({ error: "Choose a file to upload." });
        return;
      }
      if (!/\.(xlsx|csv)$/i.test(file.name)) {
        setState({ error: "Only .xlsx files are supported for this upload." });
        return;
      }

      setProgress("Reading file...");
      const buffer = await file.arrayBuffer();
      let sheets: Awaited<ReturnType<typeof readWorkbookSheets>>;
      try {
        sheets = await readWorkbookSheets(buffer, [DETAILS_SHEET]);
      } catch {
        setState({ error: "Could not read that file. Make sure it's a valid .xlsx export." });
        return;
      }
      const sheet = sheets[DETAILS_SHEET];
      if (!sheet) {
        setState({ error: `Could not find a "${DETAILS_SHEET}" sheet in that file.` });
        return;
      }

      const branchLookup = new Map<string, string>();
      branches.forEach((b) => {
        branchLookup.set(b.code.toLowerCase(), b.id);
        branchLookup.set(b.name.toLowerCase(), b.id);
      });

      let parts, skipped;
      try {
        ({ parts, skipped } = parseScrappedParts(sheet.headers, sheet.rows, branchLookup));
      } catch (err) {
        setState({ error: err instanceof Error ? err.message : "Could not parse that sheet." });
        return;
      }
      if (parts.length === 0) {
        setState({ error: "No valid rows found in that sheet.", skipped });
        return;
      }

      setProgress("Creating upload batch...");
      const startResult = await postJsonWithRetry("/api/warranty-room/upload/start", {
        kind: "scrapped_parts",
        filename: file.name,
        row_count: parts.length,
      });
      if (startResult.error || !startResult.batchId) {
        setState({ error: `Could not start the upload: ${startResult.error ?? "unknown error."}`, skipped });
        return;
      }
      const batchId = startResult.batchId as string;
      const supabase = createClient();

      let unmatched = 0;
      let merged = 0;
      let added = 0;
      const partChunks: typeof parts[] = [];
      for (let i = 0; i < parts.length; i += NETWORK_CHUNK_SIZE) partChunks.push(parts.slice(i, i + NETWORK_CHUNK_SIZE));

      const { error: chunkError } = await runChunksWithConcurrency(
        partChunks,
        async (chunk) => {
          const chunkResult = await supabaseWithRetry<{ unmatched: number; merged: number; added: number }>(
            async () => await supabase.rpc("upsert_scrapped_parts_chunk", { p_batch_id: batchId, p_rows: chunk }).single()
          );
          if (!chunkResult.error && chunkResult.data) {
            unmatched += chunkResult.data.unmatched ?? 0;
            merged += chunkResult.data.merged ?? 0;
            added += chunkResult.data.added ?? 0;
          }
          return chunkResult;
        },
        CONCURRENCY,
        (done, total) => {
          setProgress(`Uploading - ${Math.min(done * NETWORK_CHUNK_SIZE, parts.length)} of ${parts.length}`);
          setProgressPercent((done / total) * 100);
        }
      );
      if (chunkError) {
        setState({ error: `Upload failed partway through: ${chunkError}. Uploading again is safe - already-uploaded rows just get updated in place.`, skipped });
        return;
      }

      setProgress("Finishing up...");
      setProgressPercent(null);
      const finishResult = await postJsonWithRetry("/api/warranty-room/upload/finish", {
        batchId,
        totalRows: parts.length,
        filename: file.name,
      });
      if (finishResult.error) {
        setState({ error: finishResult.error as string, skipped });
        return;
      }

      setState({
        success:
          `Processed ${parts.length} row(s) from "${file.name}"` +
          (merged > 0 ? ` - ${merged} already on file (updated), ${added} new` : "") +
          ".",
        skipped,
        unmatched,
        merged,
        added,
      });
      formRef.current?.reset();
      router.refresh();
      onUploaded?.();
    } finally {
      setProgress(null);
      setProgressPercent(null);
      setPending(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="wr-scrapped-file" className="text-xs font-medium text-neutral-700">
            Parts already scraped (.xlsx)
          </label>
          <input
            id="wr-scrapped-file"
            name="file"
            type="file"
            accept=".xlsx"
            required
            className="rounded-lg border border-neutral-300 bg-white shadow-sm transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none px-3 py-1.5 text-sm text-neutral-900 file:mr-3 file:rounded-md file:border file:border-neutral-300 file:bg-white file:px-3 file:py-1 file:text-xs file:font-medium file:text-neutral-700 file:shadow-sm hover:file:bg-neutral-50"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-brand shadow-sm shadow-brand/25 hover:shadow-md hover:shadow-brand/30 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
        >
          {pending ? "Uploading..." : "Upload"}
        </button>
      </div>
      <p className="text-xs text-neutral-500">
        Reads the &quot;{DETAILS_SHEET}&quot; sheet - reference data only, used by the do-not-scrap list.
      </p>

      {progress && progressPercent == null && <p className="text-sm text-neutral-600">{progress}</p>}
      {progress && progressPercent != null && <UploadProgressBar label={progress} percent={progressPercent} />}
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.success && <p className="text-sm text-emerald-600">{state.success}</p>}
      {!!state?.unmatched && (
        <p className="text-xs text-amber-700">{state.unmatched} row(s) couldn&apos;t be matched to a known claim (kept anyway).</p>
      )}
    </form>
  );
}
