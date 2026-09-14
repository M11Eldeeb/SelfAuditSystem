"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readSpreadsheet } from "@/lib/read-spreadsheet";
import { readWorkbookFirstAndNamedSheets } from "@/lib/warranty-room/read-workbook";
import { parseClaimRows, type SkippedRow } from "@/lib/parse-claims";
import { parseClaimParts } from "@/lib/warranty-room/parse-claim-parts";
import { currentYearMonth } from "@/lib/month";
import { postJsonWithRetry, runChunksWithConcurrency } from "@/lib/warranty-room/client-upload";

type Branch = { id: string; name: string; code: string };

type UploadState =
  | {
      error?: string;
      success?: string;
      skipped?: SkippedRow[];
      partsUploaded?: number;
      unmatchedParts?: number;
      partDetailsError?: string;
    }
  | undefined;

// Rows are parsed in the browser and sent up in chunks instead of uploading
// the raw file - Vercel's serverless functions cap request bodies at 4.5MB
// (not configurable), and a real monthly export here has been 50MB+. A
// smaller chunk than the server's own DB_CHUNK_SIZE (500) gives extra
// margin against the serverless function's own execution timeout - large
// real exports here run 60,000+ rows, and even at 500/chunk a "Gateway
// Timeout" partway through has been seen in practice. Chunks run one at a
// time, not concurrently - tried running several in parallel to speed this
// up, but live testing showed it makes things *worse*: this project's
// Supabase tier clearly can't absorb several of these upserts at once,
// individual requests degraded from ~3s to 60s+ under concurrency, which is
// worse than the timeout this is trying to avoid. Every chunk still retries
// on failure (postJsonWithRetry) - upserts are idempotent, so re-sending one
// after a timeout is always safe.
const NETWORK_CHUNK_SIZE = 300;
const CONCURRENCY = 1;
const PART_DETAILS_SHEET = "Part Details";

/**
 * Uploads claims exactly as this form always has (same self_audit_claims
 * upsert, same /api/claims/upload/* routes - untouched by anything below).
 * The one addition: if the workbook also has a "Part Details" sheet (the
 * same file this app's claims exports already come in), it's parsed and
 * uploaded too, populating self_audit_claim_parts for the Warranty Room
 * scrap/do-not-scrap lists. That part is purely additive and non-blocking -
 * a missing or unparsable Part Details sheet doesn't affect the claims
 * upload at all, it's just skipped.
 */
export function ClaimsUploadForm({ branches, onUploaded }: { branches: Branch[]; onUploaded?: () => void }) {
  const [state, setState] = useState<UploadState>(undefined);
  const [progress, setProgress] = useState<string | null>(null);
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

      const claimChunks: typeof claims[] = [];
      for (let i = 0; i < claims.length; i += NETWORK_CHUNK_SIZE) claimChunks.push(claims.slice(i, i + NETWORK_CHUNK_SIZE));

      const { error: chunkError } = await runChunksWithConcurrency(
        claimChunks,
        (chunk) => postJsonWithRetry("/api/claims/upload/chunk", { batchId, claims: chunk }),
        CONCURRENCY,
        (done, total) => setProgress(`Uploading claims - ${Math.min(done * NETWORK_CHUNK_SIZE, claims.length)} of ${claims.length} (${done}/${total} chunks)...`)
      );
      if (chunkError) {
        setState({ error: `Upload failed partway through: ${chunkError}. Uploading again is safe - already-uploaded rows just get updated in place.`, skipped });
        return;
      }

      setProgress("Finishing up...");
      const finishResult = await postJsonWithRetry("/api/claims/upload/finish", {
        batchId,
        totalClaims: claims.length,
        filename: file.name,
      });
      if (finishResult.error) {
        setState({ error: finishResult.error, skipped });
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

              const { error } = await runChunksWithConcurrency(
                partChunks,
                async (chunk) => {
                  const chunkResult = await postJsonWithRetry("/api/warranty-room/upload/chunk", {
                    batchId: wrStart.batchId,
                    table: "claim_parts",
                    rows: chunk,
                  });
                  if (!chunkResult.error) {
                    partsUploaded = (partsUploaded ?? 0) + chunk.length - ((chunkResult.unmatched as number) ?? 0);
                    unmatchedParts += (chunkResult.unmatched as number) ?? 0;
                  }
                  return chunkResult;
                },
                CONCURRENCY,
                (done, total) => setProgress(`Uploading part details (${done}/${total} chunks)...`)
              );
              if (error) {
                partDetailsError = `Part details stopped partway (${partsUploaded ?? 0} of ${parts.length} rows uploaded): ${error}. Uploading the same file again is safe and will pick up the rest.`;
              }
            }
          }
        } catch (err) {
          partDetailsError = `Part details failed: ${err instanceof Error ? err.message : "unknown error"}. Uploading the same file again is safe and will pick up the rest.`;
        }
      }

      setState({ success: finishResult.success as string, skipped, partsUploaded, unmatchedParts, partDetailsError });
      formRef.current?.reset();
      router.refresh();
      onUploaded?.();
    } finally {
      setProgress(null);
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
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900"
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
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900 file:mr-3 file:rounded-md file:border file:border-neutral-300 file:bg-white file:px-3 file:py-1 file:text-xs file:font-medium file:text-neutral-700 file:shadow-sm hover:file:bg-neutral-50"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
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

      {progress && <p className="text-sm text-neutral-600">{progress}</p>}
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
