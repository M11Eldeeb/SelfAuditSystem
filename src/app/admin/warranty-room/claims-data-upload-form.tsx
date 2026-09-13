"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readWorkbookSheets } from "@/lib/warranty-room/read-workbook";
import { parseClaimRows, type SkippedRow } from "@/lib/parse-claims";
import { parseClaimParts, type SkippedPartRow } from "@/lib/warranty-room/parse-claim-parts";

type Branch = { id: string; name: string; code: string };

type UploadState =
  | {
      error?: string;
      success?: string;
      claimsCount?: number;
      partsCount?: number;
      skippedClaims?: SkippedRow[];
      skippedParts?: SkippedPartRow[];
      unmatchedParts?: number;
    }
  | undefined;

const NETWORK_CHUNK_SIZE = 1000;
const WARRANTY_BASIC_INFO_SHEET = "Warranty Basic Info";
const PART_DETAILS_SHEET = "Part Details";

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
 * Uploads the "All Claims data" export: the Warranty Basic Info sheet
 * upserts into the same self_audit_claims table self-audit/internal-audit
 * already use (so branch matching and claim data stay consistent
 * everywhere), and the Part Details sheet - which nothing in the app parses
 * today - populates self_audit_claim_parts with every part on each claim,
 * not just the one self_audit_claims.main_part_name already captures.
 */
export function ClaimsDataUploadForm({ branches }: { branches: Branch[] }) {
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
      if (branches.length === 0) {
        setState({ error: "Add at least one branch before uploading." });
        return;
      }

      setProgress("Reading file...");
      const buffer = await file.arrayBuffer();
      let sheets: Awaited<ReturnType<typeof readWorkbookSheets>>;
      try {
        sheets = await readWorkbookSheets(buffer, [WARRANTY_BASIC_INFO_SHEET, PART_DETAILS_SHEET]);
      } catch {
        setState({ error: "Could not read that file. Make sure it's a valid .xlsx export." });
        return;
      }
      const basicInfo = sheets[WARRANTY_BASIC_INFO_SHEET];
      const partDetails = sheets[PART_DETAILS_SHEET];
      if (!basicInfo) {
        setState({ error: `Could not find a "${WARRANTY_BASIC_INFO_SHEET}" sheet in that file.` });
        return;
      }

      const branchLookup = new Map<string, string>();
      branches.forEach((b) => {
        branchLookup.set(b.code.toLowerCase(), b.id);
        branchLookup.set(b.name.toLowerCase(), b.id);
      });

      let claims, skippedClaims;
      try {
        ({ claims, skipped: skippedClaims } = parseClaimRows(basicInfo.headers, basicInfo.rows, branchLookup));
      } catch (err) {
        setState({ error: err instanceof Error ? err.message : "Could not parse the Warranty Basic Info sheet." });
        return;
      }
      if (claims.length === 0) {
        setState({ error: "No valid claim rows found in the Warranty Basic Info sheet.", skippedClaims });
        return;
      }

      let parts: ReturnType<typeof parseClaimParts>["parts"] = [];
      let skippedParts: SkippedPartRow[] = [];
      if (partDetails) {
        try {
          ({ parts, skipped: skippedParts } = parseClaimParts(partDetails.headers, partDetails.rows, branchLookup));
        } catch (err) {
          setState({ error: err instanceof Error ? err.message : "Could not parse the Part Details sheet." });
          return;
        }
      }

      setProgress("Creating upload batch...");
      const startResult = await postJson("/api/warranty-room/upload/start", {
        kind: "claims_data",
        filename: file.name,
        row_count: claims.length + parts.length,
      });
      if (startResult.error || !startResult.batchId) {
        setState({ error: `Could not start the upload: ${startResult.error ?? "unknown error."}`, skippedClaims, skippedParts });
        return;
      }
      const batchId = startResult.batchId as string;

      for (let i = 0; i < claims.length; i += NETWORK_CHUNK_SIZE) {
        const chunk = claims.slice(i, i + NETWORK_CHUNK_SIZE);
        setProgress(`Uploading claims ${i + 1}-${Math.min(i + NETWORK_CHUNK_SIZE, claims.length)} of ${claims.length}...`);
        const chunkResult = await postJson("/api/warranty-room/upload/chunk", { batchId, table: "claims", rows: chunk });
        if (chunkResult.error) {
          setState({ error: `Processed ${i} of ${claims.length} claim rows before failing: ${chunkResult.error}`, skippedClaims, skippedParts });
          return;
        }
      }

      let unmatchedParts = 0;
      for (let i = 0; i < parts.length; i += NETWORK_CHUNK_SIZE) {
        const chunk = parts.slice(i, i + NETWORK_CHUNK_SIZE);
        setProgress(`Uploading parts ${i + 1}-${Math.min(i + NETWORK_CHUNK_SIZE, parts.length)} of ${parts.length}...`);
        const chunkResult = await postJson("/api/warranty-room/upload/chunk", { batchId, table: "claim_parts", rows: chunk });
        if (chunkResult.error) {
          setState({ error: `Processed ${i} of ${parts.length} part rows before failing: ${chunkResult.error}`, skippedClaims, skippedParts });
          return;
        }
        unmatchedParts += (chunkResult.unmatched as number) ?? 0;
      }

      setProgress("Finishing up...");
      const finishResult = await postJson("/api/warranty-room/upload/finish", {
        batchId,
        totalRows: claims.length + parts.length,
        filename: file.name,
      });
      if (finishResult.error) {
        setState({ error: finishResult.error as string, skippedClaims, skippedParts });
        return;
      }

      setState({
        success: `Uploaded ${claims.length} claim(s) and ${parts.length} part row(s) from "${file.name}".`,
        claimsCount: claims.length,
        partsCount: parts.length,
        skippedClaims,
        skippedParts,
        unmatchedParts,
      });
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
          <label htmlFor="wr-claims-file" className="text-xs font-medium text-neutral-700">
            All claims data (.xlsx)
          </label>
          <input
            id="wr-claims-file"
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
        The full claims export - reads both its &quot;{WARRANTY_BASIC_INFO_SHEET}&quot; sheet (updates the
        same claims data used everywhere else in the app) and its &quot;{PART_DETAILS_SHEET}&quot; sheet
        (every part per claim, used by the scrap and do-not-scrap lists below).
      </p>

      {progress && <p className="text-sm text-neutral-600">{progress}</p>}
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.success && <p className="text-sm text-emerald-600">{state.success}</p>}
      {!!state?.unmatchedParts && (
        <p className="text-xs text-amber-700">
          {state.unmatchedParts} part row(s) couldn&apos;t be matched to a claim (claim number not found) and were skipped.
        </p>
      )}
    </form>
  );
}
