"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readSpreadsheet } from "@/lib/read-spreadsheet";
import { readWorkbookFirstAndNamedSheets } from "@/lib/warranty-room/read-workbook";
import { parseClaimRows, type SkippedRow } from "@/lib/parse-claims";
import { parseClaimParts } from "@/lib/warranty-room/parse-claim-parts";
import { currentYearMonth } from "@/lib/month";
import {
  postJsonWithRetry,
  supabaseWithRetry,
  runChunksWithConcurrency,
  createPhaseTimer,
} from "@/lib/warranty-room/client-upload";
import { createClient } from "@/lib/supabase/client";
import { UploadProgressBar } from "@/components/upload-progress-bar";

type Branch = { id: string; name: string; code: string };

type UploadState =
  | {
      error?: string;
      success?: string;
      skipped?: SkippedRow[];
      partsUploaded?: number;
      unmatchedParts?: number;
      partDetailsError?: string;
      timing?: string;
    }
  | undefined;

// Rows are parsed in the browser, then each chunk upserts straight from the
// browser to Supabase (supabase.from(...).upsert(...) / supabase.rpc(...))
// instead of proxying through a Vercel API route. Root-caused via
// EXPLAIN ANALYZE against this project's real data: neither the raw upsert
// nor the RPC below is the bottleneck (a 2,000-row upsert runs in ~2.7s of
// real database time, and this project's free-tier Postgres has a 2-minute
// statement_timeout - huge headroom), and the project's Supabase
// organization is confirmed on the free plan (shared, limited compute - the
// likely reason concurrency degrades so badly, see below). With query
// execution ruled out, what actually dominated the old, much-slower version
// was the FIXED per-request overhead repeated hundreds of times: a Vercel
// function invocation plus a fresh auth.getUser() round trip to GoTrue on
// every single 300-row chunk. Calling Supabase directly removes that hop
// entirely and, since Vercel's 4.5MB request-body cap no longer applies once
// Supabase is the direct destination, lets the chunk size grow from 300 to
// 2,000 - a real 60,000+ row export now takes ~30 requests instead of ~200.
// Chunks still run one at a time, not concurrently - concurrency was tried
// and reverted previously after live testing showed this project's Postgres
// compute can't absorb several of these queries at once without individual
// requests degrading sharply; that's a database-side limit, unrelated to
// which layer issues the request, so it still applies here. Every chunk
// still retries on failure (supabaseWithRetry) - every write below is
// idempotent (upsert on a natural key), so re-sending one after a transient
// failure is always safe.
const NETWORK_CHUNK_SIZE = 2000;
const CONCURRENCY = 1;
const PART_DETAILS_SHEET = "Part Details";

/**
 * Uploads claims into the same self_audit_claims table this form always
 * has - the batch is still created and finished via /api/claims/upload/
 * start and /finish (one request each, never the bottleneck), but each
 * chunk in between now upserts directly to Supabase from the browser (see
 * NETWORK_CHUNK_SIZE above). The one addition: if the workbook also has a
 * "Part Details" sheet (the same file this app's claims exports already
 * come in), it's parsed and uploaded too via the upsert_claim_parts_chunk
 * RPC, populating self_audit_claim_parts for the Warranty Room
 * scrap/do-not-scrap lists. That part is purely additive and non-blocking -
 * a missing or unparsable Part Details sheet doesn't affect the claims
 * upload at all, it's just skipped.
 */
export function ClaimsUploadForm({ branches, onUploaded }: { branches: Branch[]; onUploaded?: () => void }) {
  const [state, setState] = useState<UploadState>(undefined);
  const [progress, setProgress] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const cancelledRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Refreshing or closing the tab mid-upload is exactly what caused a real
  // incident: the in-flight request kept running against the database with
  // nothing left able to stop it, and the project stayed stuck for a long
  // time after. This doesn't prevent that outright (the Cancel button plus
  // CHUNK_TIMEOUT_MS do), but it stops the officer from reaching for
  // refresh by accident in the first place.
  useEffect(() => {
    if (!pending) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [pending]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState(undefined);
    setPending(true);
    cancelledRef.current = false;

    try {
      const formData = new FormData(e.currentTarget);
      const file = formData.get("file");
      const claimMonth = String(formData.get("claim_month") ?? "");

      if (!(file instanceof File) || file.size === 0) {
        setState({ error: "Choose a claims file to upload." });
        return;
      }
      if (!claimMonth) {
        setState({ error: "Select which month these claims belong to." });
        return;
      }
      if (!/\.(xlsx|csv)$/i.test(file.name)) {
        setState({ error: "Only .xlsx or .csv files are supported." });
        return;
      }
      if (branches.length === 0) {
        setState({ error: "Add at least one branch before uploading claims." });
        return;
      }

      const timer = createPhaseTimer();
      setProgress("Reading file...");
      let headers: string[];
      let rows: unknown[][];
      let partDetailsSheet: { headers: string[]; rows: unknown[][] } | undefined;
      const buffer = await file.arrayBuffer();
      try {
        if (/\.xlsx$/i.test(file.name)) {
          // Read the claims sheet and the Part Details sheet in one pass -
          // a real export here can carry 4 sheets over 100MB total, and
          // loading the whole workbook a second time later just to pull
          // Part Details (as two separate calls used to) risks the browser
          // tab running out of memory or hanging with no error shown.
          const { first, named } = await readWorkbookFirstAndNamedSheets(buffer, [PART_DETAILS_SHEET]);
          headers = first.headers;
          rows = first.rows;
          partDetailsSheet = named[PART_DETAILS_SHEET];
        } else {
          ({ headers, rows } = await readSpreadsheet(buffer, file.name));
        }
      } catch {
        setState({ error: "Could not read that file. Make sure it's a valid .xlsx or .csv export." });
        return;
      }
      timer.mark("Read file");

      const branchLookup = new Map<string, string>();
      branches.forEach((b) => {
        branchLookup.set(b.code.toLowerCase(), b.id);
        branchLookup.set(b.name.toLowerCase(), b.id);
      });

      let claims, skipped;
      try {
        ({ claims, skipped } = parseClaimRows(headers, rows, branchLookup));
      } catch (err) {
        setState({ error: err instanceof Error ? err.message : "Could not parse the file." });
        return;
      }

      timer.mark("Parse claims");
      if (claims.length === 0) {
        setState({ error: "No valid claim rows found in that file.", skipped });
        return;
      }

      setProgress("Creating upload batch...");
      const startResult = await postJsonWithRetry("/api/claims/upload/start", {
        claim_month: claimMonth,
        filename: file.name,
        row_count: claims.length,
      });
      if (startResult.error || !startResult.batchId) {
        setState({ error: `Could not start the upload: ${startResult.error ?? "unknown error."}`, skipped });
        return;
      }
      const batchId = startResult.batchId as string;
      const supabase = createClient();
      timer.mark("Create batch");

      const claimChunks: typeof claims[] = [];
      for (let i = 0; i < claims.length; i += NETWORK_CHUNK_SIZE) claimChunks.push(claims.slice(i, i + NETWORK_CHUNK_SIZE));

      const { error: chunkError, cancelled } = await runChunksWithConcurrency(
        claimChunks,
        (chunk) =>
          supabaseWithRetry(
            async (signal) =>
              await supabase
                .from("self_audit_claims")
                .upsert(
                  chunk.map((c) => ({ ...c, upload_batch_id: batchId })),
                  { onConflict: "branch_id,claim_number" }
                )
                .abortSignal(signal),
            (controller) => (abortControllerRef.current = controller)
          ),
        CONCURRENCY,
        (done, total) => {
          setProgress(`Uploading claims - ${Math.min(done * NETWORK_CHUNK_SIZE, claims.length)} of ${claims.length}`);
          setProgressPercent((done / total) * 100);
        },
        () => cancelledRef.current
      );
      timer.mark("Upload claims");
      if (chunkError) {
        setState({ error: `Upload failed partway through: ${chunkError}. Uploading again is safe - already-uploaded rows just get updated in place.`, skipped, timing: timer.summary() });
        return;
      }
      // Cancelled partway through - the batch isn't finished, so skip
      // /finish entirely: finish_claims_upload treats every claim missing
      // from a batch as stale for the branch(es) it covers and removes it,
      // which would be wrong here since most rows simply haven't been sent
      // yet, not genuinely absent from the source file.
      if (cancelled) {
        setState({
          error: `Upload cancelled - already-uploaded rows are saved. Upload the same file again to finish (nothing was removed, since this batch never finished).`,
          skipped,
          timing: timer.summary(),
        });
        return;
      }

      setProgress("Finishing up...");
      setProgressPercent(null);
      const finishResult = await postJsonWithRetry("/api/claims/upload/finish", {
        batchId,
        totalClaims: claims.length,
        filename: file.name,
      });
      timer.mark("Finish");
      if (finishResult.error) {
        setState({ error: finishResult.error, skipped, timing: timer.summary() });
        return;
      }

      // Optional bonus: if this same workbook also has a Part Details sheet
      // (already read alongside the claims sheet above, xlsx only), upload
      // it too - every part on a claim, not just the one
      // self_audit_claims.main_part_name captures. A failure here never
      // turns the overall upload into an error (the claims upload above
      // already succeeded) - but it IS surfaced as its own warning with
      // however many rows made it in, rather than silently claiming success
      // on a partial result (this used to happen: the loop's error return
      // was discarded, so a chunk failing partway through a 78,000-row sheet
      // looked identical to a full success with no way to tell).
      let partsUploaded: number | undefined;
      let unmatchedParts = 0;
      let partDetailsError: string | undefined;
      if (partDetailsSheet) {
        try {
          const { parts } = parseClaimParts(partDetailsSheet.headers, partDetailsSheet.rows, branchLookup);
          if (parts.length > 0) {
            const wrStart = await postJsonWithRetry("/api/warranty-room/upload/start", {
              kind: "claims_data",
              filename: file.name,
              row_count: parts.length,
            });
            if (wrStart.batchId) {
              partsUploaded = 0;
              const partChunks: typeof parts[] = [];
              for (let i = 0; i < parts.length; i += NETWORK_CHUNK_SIZE) partChunks.push(parts.slice(i, i + NETWORK_CHUNK_SIZE));

              const { error, cancelled: partsCancelled } = await runChunksWithConcurrency(
                partChunks,
                async (chunk) => {
                  const chunkResult = await supabaseWithRetry(
                    async (signal) =>
                      await supabase
                        .rpc("upsert_claim_parts_chunk", { p_batch_id: wrStart.batchId as string, p_rows: chunk })
                        .abortSignal(signal),
                    (controller) => (abortControllerRef.current = controller)
                  );
                  if (!chunkResult.error) {
                    const unmatchedInChunk = chunkResult.data ?? 0;
                    partsUploaded = (partsUploaded ?? 0) + chunk.length - unmatchedInChunk;
                    unmatchedParts += unmatchedInChunk;
                  }
                  return chunkResult;
                },
                CONCURRENCY,
                (done, total) => {
                  setProgress(`Uploading part details - ${Math.min(done * NETWORK_CHUNK_SIZE, parts.length)} of ${parts.length}`);
                  setProgressPercent((done / total) * 100);
                },
                () => cancelledRef.current
              );
              if (error) {
                partDetailsError = `Part details stopped partway (${partsUploaded ?? 0} of ${parts.length} rows uploaded): ${error}. Uploading the same file again is safe and will pick up the rest.`;
              } else if (partsCancelled) {
                partDetailsError = `Part details cancelled (${partsUploaded ?? 0} of ${parts.length} rows uploaded) - already-uploaded rows are saved. Upload the same file again to pick up the rest.`;
              }
            }
          }
        } catch (err) {
          partDetailsError = `Part details failed: ${err instanceof Error ? err.message : "unknown error"}. Uploading the same file again is safe and will pick up the rest.`;
        }
        timer.mark("Upload part details");
      }

      setState({
        success: finishResult.success as string,
        skipped,
        partsUploaded,
        unmatchedParts,
        partDetailsError,
        timing: timer.summary(),
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
          <label htmlFor="claim_month" className="text-xs font-medium text-neutral-700">
            Claims month
          </label>
          <input
            id="claim_month"
            name="claim_month"
            type="month"
            required
            defaultValue={currentYearMonth()}
            className="rounded-lg border border-neutral-300 bg-white shadow-sm transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none px-3 py-1.5 text-sm text-neutral-900"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="file" className="text-xs font-medium text-neutral-700">
            Claims file (.xlsx or .csv)
          </label>
          <input
            id="file"
            name="file"
            type="file"
            accept=".xlsx,.csv"
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
        Expected columns (any order, header names are flexible): Branch, Claim Number, VIN,
        Vehicle Model, Mileage, Part Serial Number, Part Production Date, Repair End Date, Dealer
        Submit Date, Creation Date. Branch, Claim Number, and Creation Date are required. If the
        file also has a &quot;{PART_DETAILS_SHEET}&quot; sheet, every part on each claim is picked up too
        (used by the scrap and do-not-scrap lists below). The file is parsed in your browser, so
        there&apos;s no size limit from the server.
      </p>

      {progress && progressPercent == null && <p className="text-sm text-neutral-600">{progress}</p>}
      {progress && progressPercent != null && (
        <div className="flex max-w-sm items-end gap-3">
          <div className="flex-1">
            <UploadProgressBar label={progress} percent={progressPercent} />
          </div>
          <button
            type="button"
            onClick={() => {
              cancelledRef.current = true;
              abortControllerRef.current?.abort();
            }}
            className="shrink-0 rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 shadow-sm transition hover:bg-neutral-50"
          >
            Cancel
          </button>
        </div>
      )}
      {state?.timing && <p className="text-xs text-neutral-400">Timing: {state.timing}</p>}
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.success && <p className="text-sm text-emerald-600">{state.success}</p>}
      {typeof state?.partsUploaded === "number" && (
        <p className="text-sm text-emerald-600">Also uploaded {state.partsUploaded} part detail row(s).</p>
      )}
      {!!state?.unmatchedParts && (
        <p className="text-xs text-amber-700">
          {state.unmatchedParts} part row(s) couldn&apos;t be matched to a claim and were skipped.
        </p>
      )}
      {state?.partDetailsError && <p className="text-sm text-amber-700">{state.partDetailsError}</p>}

      {state?.skipped && state.skipped.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <p className="font-medium">{state.skipped.length} row(s) skipped:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {state.skipped.slice(0, 15).map((s, i) => (
              <li key={i}>
                Row {s.row}: {s.reason}
              </li>
            ))}
          </ul>
          {state.skipped.length > 15 && <p className="mt-1">and {state.skipped.length - 15} more.</p>}
        </div>
      )}
    </form>
  );
}
