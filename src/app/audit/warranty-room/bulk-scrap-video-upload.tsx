"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { submitScrapRequestsBulk } from "./actions";

type Req = { id: string; claimNumber: string; workOrderNo: string | null };

/**
 * One or more videos, one button, applied to every pending claim at once -
 * not one video per claim (the branch films the destruction in one session
 * covering everything, so the same set of videos applies to all of them).
 * Multiple files are allowed since a single video isn't always practical
 * (several angles, a session split into clips).
 */
export function BulkScrapVideoUpload({ requests }: { requests: Req[] }) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ claimNumber: string; error?: string }[] | null>(null);
  const router = useRouter();

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(e.target.files ?? []));
    setResults(null);
    setError(null);
  }

  async function handleSubmit() {
    if (files.length === 0) {
      setError("Choose at least one video first.");
      return;
    }

    setUploading(true);
    setError(null);
    setResults(null);

    try {
      const supabase = createClient();
      // One shared folder (not per claim) since it's the same videos for
      // every claim - each submission below just points at these same paths.
      const folder = `bulk-${crypto.randomUUID()}`;
      const paths: string[] = [];
      for (let i = 0; i < files.length; i++) {
        setProgress(`Uploading video ${i + 1} of ${files.length}...`);
        const file = files[i];
        const ext = file.name.split(".").pop() || "bin";
        const path = `${folder}/video-${i + 1}-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("warranty-room-files")
          .upload(path, file, { upsert: true, contentType: file.type || undefined });
        if (uploadError) {
          setError(`Upload failed on video ${i + 1}: ${uploadError.message}`);
          return;
        }
        paths.push(path);
      }

      setProgress(`Submitting ${requests.length} claim(s)...`);
      const mappings = requests.map((r) => ({ requestId: r.id, claimNumber: r.claimNumber, videoPaths: paths }));
      const { results: submitResults } = await submitScrapRequestsBulk(mappings);
      setResults(submitResults.map((r) => ({ claimNumber: r.claimNumber, error: r.error })));
      setFiles([]);
      router.refresh();
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  if (requests.length === 0) return null;

  return (
    <div className="space-y-3 rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4">
      <div className="space-y-1">
        <label className="text-sm font-medium text-neutral-700">Destruction video(s)</label>
        <p className="text-xs text-neutral-500">
          One or more videos, submitted for all {requests.length} pending claim(s) below at once - no
          need to upload one per part.
        </p>
        <input
          type="file"
          accept="video/*"
          multiple
          disabled={uploading}
          onChange={handleFiles}
          className="block w-full text-sm text-neutral-700 file:mr-3 file:rounded-md file:border file:border-neutral-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-neutral-700 file:shadow-sm hover:file:bg-neutral-50"
        />
        {files.length > 0 && (
          <p className="text-xs text-neutral-500">{files.length} video(s) selected.</p>
        )}
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

      {files.length > 0 && (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={uploading}
          className="rounded-lg bg-brand shadow-sm shadow-brand/25 hover:shadow-md hover:shadow-brand/30 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
        >
          {uploading ? "Submitting..." : `Submit for all ${requests.length} claim(s)`}
        </button>
      )}
    </div>
  );
}
