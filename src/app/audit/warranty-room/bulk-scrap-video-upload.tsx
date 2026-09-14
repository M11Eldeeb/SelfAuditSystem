"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { submitScrapRequestsBulk } from "./actions";

type Req = { id: string; claimNumber: string; workOrderNo: string | null };

/**
 * One file picker for every pending claim instead of one upload per claim -
 * the branch selects all their destruction videos at once (one per claim),
 * they're auto-matched to claims in list order (overridable per row in case
 * the file order doesn't match), then everything uploads and submits
 * together behind a single button.
 */
export function BulkScrapVideoUpload({ requests }: { requests: Req[] }) {
  const [files, setFiles] = useState<File[]>([]);
  const [assignment, setAssignment] = useState<Record<string, number | "">>({});
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ claimNumber: string; error?: string }[] | null>(null);
  const router = useRouter();

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? []);
    setFiles(list);
    setResults(null);
    setError(null);
    const next: Record<string, number | ""> = {};
    requests.forEach((r, i) => {
      next[r.id] = i < list.length ? i : "";
    });
    setAssignment(next);
  }

  function updateAssignment(requestId: string, value: string) {
    setAssignment((prev) => ({ ...prev, [requestId]: value === "" ? "" : Number(value) }));
  }

  async function handleSubmit() {
    const toSubmit = requests.filter((r) => assignment[r.id] !== "" && assignment[r.id] !== undefined);
    if (toSubmit.length === 0) {
      setError("Assign a video to at least one claim.");
      return;
    }

    setUploading(true);
    setError(null);
    setResults(null);

    try {
      const supabase = createClient();
      const mappings: { requestId: string; claimNumber: string; videoPath: string }[] = [];

      for (let i = 0; i < toSubmit.length; i++) {
        const r = toSubmit[i];
        const file = files[assignment[r.id] as number];
        setProgress(`Uploading video ${i + 1} of ${toSubmit.length} (claim ${r.claimNumber})...`);
        const ext = file.name.split(".").pop() || "bin";
        const path = `${r.id}/video-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("warranty-room-files")
          .upload(path, file, { upsert: true, contentType: file.type || undefined });
        if (uploadError) {
          setError(`Upload failed for claim ${r.claimNumber}: ${uploadError.message}`);
          setUploading(false);
          setProgress(null);
          return;
        }
        mappings.push({ requestId: r.id, claimNumber: r.claimNumber, videoPath: path });
      }

      setProgress("Submitting...");
      const { results: submitResults } = await submitScrapRequestsBulk(mappings);
      setResults(submitResults.map((r) => ({ claimNumber: r.claimNumber, error: r.error })));
      setFiles([]);
      setAssignment({});
      router.refresh();
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  if (requests.length === 0) return null;

  return (
    <div className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
      <div className="space-y-1">
        <label className="text-sm font-medium text-neutral-700">Destruction videos</label>
        <p className="text-xs text-neutral-500">
          Select all your destruction videos at once (one per claim) - they&apos;re matched to claims below in the
          order selected. Fix any mismatch with the dropdown next to each claim, then submit everything together.
        </p>
        <input
          type="file"
          accept="video/*"
          multiple
          disabled={uploading}
          onChange={handleFiles}
          className="block w-full text-sm text-neutral-700 file:mr-3 file:rounded-md file:border file:border-neutral-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-neutral-700 file:shadow-sm hover:file:bg-neutral-50"
        />
      </div>

      {files.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-neutral-100">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-medium uppercase text-neutral-500">
              <tr>
                <th className="px-3 py-1.5">Claim</th>
                <th className="px-3 py-1.5">Video file</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {requests.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-1.5 text-neutral-900">
                    {r.claimNumber}
                    {r.workOrderNo && <span className="text-neutral-500"> · WO {r.workOrderNo}</span>}
                  </td>
                  <td className="px-3 py-1.5">
                    <select
                      value={assignment[r.id] ?? ""}
                      onChange={(e) => updateAssignment(r.id, e.target.value)}
                      disabled={uploading}
                      className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
                    >
                      <option value="">— none —</option>
                      {files.map((f, i) => (
                        <option key={i} value={i}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {progress && <p className="text-sm text-neutral-600">{progress}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {results && (
        <div className="space-y-1 text-sm">
          {results.map((r) => (
            <p key={r.claimNumber} className={r.error ? "text-red-600" : "text-emerald-600"}>
              Claim {r.claimNumber}: {r.error ?? "submitted"}
            </p>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={uploading}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
        >
          {uploading ? "Submitting..." : "Upload & submit all"}
        </button>
      )}
    </div>
  );
}
