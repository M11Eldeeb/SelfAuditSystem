"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readWorkbookSheets } from "@/lib/warranty-room/read-workbook";
import { parseScrapRequests, type SkippedScrapRequestRow } from "@/lib/warranty-room/parse-scrap-requests";

type Branch = { id: string; name: string; code: string };

type UploadState =
  | { error?: string; success?: string; skipped?: SkippedScrapRequestRow[]; skippedNoParts?: number; unmatchedClaims?: number }
  | undefined;

// Matches the server's own DB_CHUNK_SIZE (see warranty-room/upload.ts) so
// each request does exactly one round of DB work - avoids the serverless
// function's own execution timeout on large exports.
const NETWORK_CHUNK_SIZE = 500;
const DETAILS_SHEET = "RepClaimOrderView";

async function postJson(url: string, body: unknown): Promise<{ error?: string; [key: string]: unknown }> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { error: "check your connection and try again." };
  }
  try {
    return await res.json();
  } catch {
    if (res.status === 413) return { error: "that chunk was too large for the server to accept." };
    return { error: `server returned an unexpected response (status ${res.status}).` };
  }
}

/**
 * Uploads "Parts should be scraped" - one row per claim. Each claim's actual
 * part list comes from self_audit_claim_parts (populated by the All Claims
 * Data upload above) minus anything already reserved for the supplier, so
 * this file only needs to say which CLAIMS should be scrapped.
 */
export function ScrapRequestsUploadForm({ branches }: { branches: Branch[] }) {
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

      let requests, skipped;
      try {
        ({ requests, skipped } = parseScrapRequests(sheet.headers, sheet.rows, branchLookup));
      } catch (err) {
        setState({ error: err instanceof Error ? err.message : "Could not parse that sheet." });
        return;
      }
      if (requests.length === 0) {
        setState({ error: "No valid rows found in that sheet.", skipped });
        return;
      }

      setProgress("Creating upload batch...");
      const startResult = await postJson("/api/warranty-room/upload/start", {
        kind: "scrap_requests",
        filename: file.name,
        row_count: requests.length,
      });
      if (startResult.error || !startResult.batchId) {
        setState({ error: `Could not start the upload: ${startResult.error ?? "unknown error."}`, skipped });
        return;
      }
      const batchId = startResult.batchId as string;

      let skippedNoParts = 0;
      let unmatchedClaims = 0;
      for (let i = 0; i < requests.length; i += NETWORK_CHUNK_SIZE) {
        const chunk = requests.slice(i, i + NETWORK_CHUNK_SIZE);
        setProgress(`Processing ${i + 1}-${Math.min(i + NETWORK_CHUNK_SIZE, requests.length)} of ${requests.length}...`);
        const chunkResult = await postJson("/api/warranty-room/upload/chunk", { batchId, table: "scrap_requests", rows: chunk });
        if (chunkResult.error) {
          setState({ error: `Processed ${i} of ${requests.length} rows before failing: ${chunkResult.error}`, skipped });
          return;
        }
        skippedNoParts += (chunkResult.skippedNoParts as number) ?? 0;
        unmatchedClaims += (chunkResult.unmatchedClaims as number) ?? 0;
      }

      setProgress("Finishing up...");
      const finishResult = await postJson("/api/warranty-room/upload/finish", {
        batchId,
        totalRows: requests.length,
        filename: file.name,
      });
      if (finishResult.error) {
        setState({ error: finishResult.error as string, skipped });
        return;
      }

      setState({ success: `Processed ${requests.length} claim(s) from "${file.name}".`, skipped, skippedNoParts, unmatchedClaims });
      formRef.current?.reset();
      router.refresh();
    } finally {
      setProgress(null);
      setPending(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="wr-scrap-req-file" className="text-xs font-medium text-neutral-700">
            Parts should be scraped (.xlsx)
          </label>
          <input
            id="wr-scrap-req-file"
            name="file"
            type="file"
            accept=".xlsx"
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
        Reads the &quot;{DETAILS_SHEET}&quot; sheet - one row per claim. Any part already reserved for the
        supplier is automatically excluded from what the branch is asked to scrap.
      </p>

      {progress && <p className="text-sm text-neutral-600">{progress}</p>}
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.success && <p className="text-sm text-emerald-600">{state.success}</p>}
      {!!state?.skippedNoParts && (
        <p className="text-xs text-amber-700">
          {state.skippedNoParts} claim(s) had no parts left to scrap (either no part data on file yet, or every part
          is reserved for the supplier) and were skipped.
        </p>
      )}
      {!!state?.unmatchedClaims && (
        <p className="text-xs text-amber-700">{state.unmatchedClaims} claim(s) couldn&apos;t be matched to a known claim and were skipped.</p>
      )}
    </form>
  );
}
