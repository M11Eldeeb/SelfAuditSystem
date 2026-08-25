"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readSpreadsheet } from "@/lib/read-spreadsheet";
import { parseClaimRows, type ParsedClaimRow, type SkippedRow } from "@/lib/parse-claims";

type Branch = { id: string; name: string; code: string };

type UploadState =
  | { error?: string; success?: string; inserted?: number; skipped?: SkippedRow[] }
  | undefined;

// Rows are parsed in the browser and sent up in chunks instead of uploading
// the raw file - Vercel's serverless functions cap request bodies at 4.5MB
// (not configurable), and a real monthly export here has been 50MB+.
const NETWORK_CHUNK_SIZE = 1000;

async function postJson(url: string, body: unknown): Promise<{ error?: string; [key: string]: unknown }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
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

function defaultClaimMonth(): string {
  const now = new Date();
  now.setMonth(now.getMonth() - 1); // claims uploaded in Aug are usually July's claims
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function UploadForm({ branches }: { branches: Branch[] }) {
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
      try {
        const buffer = await file.arrayBuffer();
        ({ headers, rows } = await readSpreadsheet(buffer, file.name));
      } catch {
        setState({ error: "Could not read that file. Make sure it's a valid .xlsx or .csv export." });
        return;
      }

      const branchLookup = new Map<string, string>();
      branches.forEach((b) => {
        branchLookup.set(b.code.toLowerCase(), b.id);
        branchLookup.set(b.name.toLowerCase(), b.id);
      });

      let claims: ParsedClaimRow[];
      let skipped: SkippedRow[];
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
      const startResult = await postJson("/api/claims/upload/start", {
        claim_month: claimMonth,
        filename: file.name,
        row_count: claims.length,
      });
      if (startResult.error || !startResult.batchId) {
        setState({ error: `Could not start the upload: ${startResult.error ?? "unknown error."}`, skipped });
        return;
      }
      const batchId = startResult.batchId as string;

      for (let i = 0; i < claims.length; i += NETWORK_CHUNK_SIZE) {
        const chunk = claims.slice(i, i + NETWORK_CHUNK_SIZE);
        setProgress(
          `Uploading claims ${i + 1}-${Math.min(i + NETWORK_CHUNK_SIZE, claims.length)} of ${claims.length}...`
        );
        const chunkResult = await postJson("/api/claims/upload/chunk", { batchId, claims: chunk });
        if (chunkResult.error) {
          setState({
            error: `Processed ${i} of ${claims.length} rows before failing: ${chunkResult.error}`,
            skipped,
          });
          return;
        }
      }

      setProgress("Finishing up...");
      const finishResult = await postJson("/api/claims/upload/finish", {
        batchId,
        totalClaims: claims.length,
        filename: file.name,
      });
      if (finishResult.error) {
        setState({ error: finishResult.error, skipped });
        return;
      }

      setState({ success: finishResult.success as string, inserted: claims.length, skipped });
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
          <label htmlFor="claim_month" className="text-xs font-medium text-neutral-700">
            Claims month
          </label>
          <input
            id="claim_month"
            name="claim_month"
            type="month"
            required
            defaultValue={defaultClaimMonth()}
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
        Submit Date, Creation Date. Branch, Claim Number, and Creation Date are required. The file
        is parsed in your browser, so there&apos;s no size limit from the server.
      </p>

      {progress && <p className="text-sm text-neutral-600">{progress}</p>}
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.success && <p className="text-sm text-emerald-600">{state.success}</p>}

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
          {state.skipped.length > 15 && (
            <p className="mt-1">and {state.skipped.length - 15} more.</p>
          )}
        </div>
      )}
    </form>
  );
}
