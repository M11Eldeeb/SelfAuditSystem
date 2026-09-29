"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { submitDestroyEvidence } from "./destroy-evidence-actions";

type Status = "pending" | "submitted" | "sent";

export function SubmitDestroyEvidence({
  cycleId,
  branchId,
  cycleMonthLabel,
  daysLeft,
  status,
}: {
  cycleId: string;
  branchId: string;
  cycleMonthLabel: string;
  daysLeft: number | null;
  status: Status;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const deadlinePassed = daysLeft !== null && daysLeft <= 0;
  const locked = status !== "pending" || deadlinePassed;

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(e.target.files ?? []));
    setError(null);
  }

  async function handleSubmit() {
    if (files.length === 0) {
      setError("Choose at least one video first.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const supabase = createClient();
      const paths: string[] = [];
      for (let i = 0; i < files.length; i++) {
        setProgress(`Uploading video ${i + 1} of ${files.length}...`);
        const file = files[i];
        const ext = file.name.split(".").pop() || "bin";
        const path = `destroy-evidence/${branchId}/${cycleId}/video-${i + 1}-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("warranty-room-files")
          .upload(path, file, { upsert: true, contentType: file.type || undefined });
        if (uploadError) {
          setError(`Upload failed on video ${i + 1}: ${uploadError.message}`);
          return;
        }
        paths.push(path);
      }

      setProgress("Submitting...");
      const result = await submitDestroyEvidence(cycleId, paths);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setFiles([]);
      router.refresh();
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-900">Submit destroy evidence</h2>
        <span className="text-xs text-neutral-500">
          {cycleMonthLabel} cycle
          {daysLeft !== null && (
            <span className={`ml-2 font-medium ${daysLeft <= 5 ? "text-red-600" : "text-neutral-500"}`}>
              {daysLeft > 0 ? `· ${daysLeft} day${daysLeft === 1 ? "" : "s"} left to submit` : "· Submission deadline passed"}
            </span>
          )}
        </span>
      </div>

      {status === "submitted" && <p className="text-sm text-emerald-700">Submitted - awaiting the officer to collect it.</p>}
      {status === "sent" && <p className="text-sm text-neutral-500">Submitted and collected by the officer for this cycle.</p>}
      {status === "pending" && deadlinePassed && <p className="text-sm text-red-600">The submission deadline for this cycle has passed.</p>}

      {!locked && (
        <>
          <div className="space-y-1">
            <p className="text-xs text-neutral-500">
              One or more videos covering everything scrapped this month - one submission per branch, not per claim.
            </p>
            <input
              type="file"
              accept="video/*"
              multiple
              disabled={uploading}
              onChange={handleFiles}
              className="block w-full text-sm text-neutral-700 file:mr-3 file:rounded-md file:border file:border-neutral-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-neutral-700 file:shadow-sm hover:file:bg-neutral-50"
            />
            {files.length > 0 && <p className="text-xs text-neutral-500">{files.length} video(s) selected.</p>}
          </div>

          {progress && <p className="text-sm text-neutral-600">{progress}</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}

          {files.length > 0 && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={uploading}
              className="rounded-lg bg-brand shadow-sm shadow-brand/25 hover:shadow-md hover:shadow-brand/30 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
            >
              {uploading ? "Submitting..." : "Submit destroy evidence"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
