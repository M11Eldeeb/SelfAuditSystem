"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { submitScrapRequestsBulk } from "./actions";

type Req = { id: string; claimNumber: string; workOrderNo: string | null };

/**
 * One video, one button, applied to every pending claim at once - not one
 * video per claim (the branch films a single destruction video covering
 * everything in that session, so one upload should be enough to submit all
 * of them).
 */
export function BulkScrapVideoUpload({ requests }: { requests: Req[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ claimNumber: string; error?: string }[] | null>(null);
  const router = useRouter();

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
    setResults(null);
    setError(null);
  }

  async function handleSubmit() {
    if (!file) {
      setError("Choose a video first.");
      return;
    }

    setUploading(true);
    setError(null);
    setResults(null);

    try {
      setProgress("Uploading video...");
      const supabase = createClient();
      const ext = file.name.split(".").pop() || "bin";
      // One shared path (not per claim) since it's the same file for every
      // claim - each submission below just points at this same video.
      const path = `bulk-${crypto.randomUUID()}/video-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("warranty-room-files")
        .upload(path, file, { upsert: true, contentType: file.type || undefined });
      if (uploadError) {
        setError(`Upload failed: ${uploadError.message}`);
        return;
      }

      setProgress(`Submitting ${requests.length} claim(s)...`);
      const mappings = requests.map((r) => ({ requestId: r.id, claimNumber: r.claimNumber, videoPath: path }));
      const { results: submitResults } = await submitScrapRequestsBulk(mappings);
      setResults(submitResults.map((r) => ({ claimNumber: r.claimNumber, error: r.error })));
      setFile(null);
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
        <label className="text-sm font-medium text-neutral-700">Destruction video</label>
        <p className="text-xs text-neutral-500">
          One video, submitted for all {requests.length} pending claim(s) below at once - no need to upload one per part.
        </p>
        <input
          type="file"
          accept="video/*"
          disabled={uploading}
          onChange={handleFile}
          className="block w-full text-sm text-neutral-700 file:mr-3 file:rounded-md file:border file:border-neutral-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-neutral-700 file:shadow-sm hover:file:bg-neutral-50"
        />
      </div>

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

      {file && (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={uploading}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
        >
          {uploading ? "Submitting..." : `Submit for all ${requests.length} claim(s)`}
        </button>
      )}
    </div>
  );
}
