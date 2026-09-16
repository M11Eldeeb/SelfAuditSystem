"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readWorkbookSheets } from "@/lib/warranty-room/read-workbook";
import { parseSupplierParts, type SkippedSupplierPartRow } from "@/lib/warranty-room/parse-supplier-parts";
import { postJsonWithRetry } from "@/lib/warranty-room/client-upload";
import { UploadProgressBar } from "@/components/upload-progress-bar";

type Branch = { id: string; name: string; code: string };

type UploadState =
  | {
      error?: string;
      success?: string;
      skipped?: SkippedSupplierPartRow[];
      unmatchedClaims?: number;
      alreadyHandedOver?: number;
      merged?: number;
      added?: number;
      mainPartOnly?: number;
    }
  | undefined;

// Matches the server's own DB_CHUNK_SIZE (see warranty-room/upload.ts) so
// each request does exactly one round of DB work. Chunks are sent one at a
// time (not concurrently, unlike the other upload forms) - a chunk can
// create a new pending collection for a branch if one doesn't exist yet, and
// running two chunks for the same new branch at once could race and create
// two. Every chunk still retries on failure (postJsonWithRetry) - the
// upsert this hits is idempotent, so re-sending one after a timeout is safe.
const NETWORK_CHUNK_SIZE = 500;
const SHEET_NAME = "Sheet1";

/**
 * Uploads the Supplier Parts list and groups it into one collection per
 * branch (a physical hand-over/signature happens at one branch at a time).
 * The officer sets one collection date for the whole upload here; the
 * sheet's own per-row planned pickup date is kept as read-only reference
 * info alongside it.
 */
export function SupplierPartsUploadForm({ branches, onUploaded }: { branches: Branch[]; onUploaded?: () => void }) {
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
      const collectionDate = String(formData.get("collection_date") ?? "") || null;
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
        sheets = await readWorkbookSheets(buffer, [SHEET_NAME]);
      } catch {
        setState({ error: "Could not read that file. Make sure it's a valid .xlsx export." });
        return;
      }
      const sheet = sheets[SHEET_NAME];
      if (!sheet) {
        setState({ error: `Could not find a "${SHEET_NAME}" sheet in that file.` });
        return;
      }

      const branchLookup = new Map<string, string>();
      branches.forEach((b) => {
        branchLookup.set(b.code.toLowerCase(), b.id);
        branchLookup.set(b.name.toLowerCase(), b.id);
      });

      let parts, skipped;
      try {
        ({ parts, skipped } = parseSupplierParts(sheet.headers, sheet.rows, branchLookup));
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
        kind: "supplier_parts",
        filename: file.name,
        row_count: parts.length,
      });
      if (startResult.error || !startResult.batchId) {
        setState({ error: `Could not start the upload: ${startResult.error ?? "unknown error."}`, skipped });
        return;
      }
      const batchId = startResult.batchId as string;

      let unmatchedClaims = 0;
      let alreadyHandedOver = 0;
      let merged = 0;
      let added = 0;
      let mainPartOnly = 0;
      for (let i = 0; i < parts.length; i += NETWORK_CHUNK_SIZE) {
        const chunk = parts.slice(i, i + NETWORK_CHUNK_SIZE);
        setProgress(`Uploading ${i + 1}-${Math.min(i + NETWORK_CHUNK_SIZE, parts.length)} of ${parts.length}`);
        setProgressPercent((Math.min(i + NETWORK_CHUNK_SIZE, parts.length) / parts.length) * 100);
        const chunkResult = await postJsonWithRetry("/api/warranty-room/upload/chunk", {
          batchId,
          table: "supplier_parts",
          collectionDate,
          rows: chunk,
        });
        if (chunkResult.error) {
          setState({
            error: `Upload failed partway through (${i} of ${parts.length} rows processed): ${chunkResult.error}. Uploading again is safe - already-uploaded rows just get merged.`,
            skipped,
          });
          return;
        }
        unmatchedClaims += (chunkResult.unmatchedClaims as number) ?? 0;
        alreadyHandedOver += (chunkResult.alreadyHandedOver as number) ?? 0;
        merged += (chunkResult.merged as number) ?? 0;
        added += (chunkResult.added as number) ?? 0;
        mainPartOnly += (chunkResult.mainPartOnly as number) ?? 0;
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
          (merged > 0 ? ` - ${merged} already reserved (merged into the existing collection), ${added} new` : "") +
          ".",
        skipped,
        unmatchedClaims,
        alreadyHandedOver,
        merged,
        added,
        mainPartOnly,
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
          <label htmlFor="wr-supplier-file" className="text-xs font-medium text-neutral-700">
            Supplier parts (.xlsx)
          </label>
          <input
            id="wr-supplier-file"
            name="file"
            type="file"
            accept=".xlsx"
            required
            className="rounded-lg border border-neutral-300 bg-white shadow-sm transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none px-3 py-1.5 text-sm text-neutral-900 file:mr-3 file:rounded-md file:border file:border-neutral-300 file:bg-white file:px-3 file:py-1 file:text-xs file:font-medium file:text-neutral-700 file:shadow-sm hover:file:bg-neutral-50"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="wr-collection-date" className="text-xs font-medium text-neutral-700">
            Collection date
          </label>
          <input
            id="wr-collection-date"
            name="collection_date"
            type="date"
            className="rounded-lg border border-neutral-300 bg-white shadow-sm transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none px-3 py-1.5 text-sm text-neutral-900"
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
        Groups rows into one collection per branch. The branch downloads its list, gets it signed and
        video-recorded, and hands it over once the supplier collects it.
      </p>

      {progress && progressPercent == null && <p className="text-sm text-neutral-600">{progress}</p>}
      {progress && progressPercent != null && <UploadProgressBar label={progress} percent={progressPercent} />}
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.success && <p className="text-sm text-emerald-600">{state.success}</p>}
      {!!state?.unmatchedClaims && (
        <p className="text-xs text-amber-700">{state.unmatchedClaims} row(s) couldn&apos;t be matched to a known claim (kept anyway).</p>
      )}
      {!!state?.alreadyHandedOver && (
        <p className="text-xs text-amber-700">
          {state.alreadyHandedOver} claim(s) were skipped - already in a collection that&apos;s been handed over.
        </p>
      )}
      {!!state?.mainPartOnly && (
        <p className="text-xs text-amber-700">
          {state.mainPartOnly} claim(s) only had their main part reserved - full part details for those claims
          aren&apos;t on file yet, so any other parts on them are NOT excluded from scrapping. Re-upload this file
          after their part details are loaded (via All Claims Data) to reserve the rest.
        </p>
      )}
    </form>
  );
}
