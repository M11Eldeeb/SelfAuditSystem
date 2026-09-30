"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { addDestroyEvidenceVideo, deleteDestroyEvidenceVideo, submitDestroyEvidence } from "./destroy-evidence-actions";

type Status = "pending" | "submitted" | "sent";
type Video = { id: string; path: string; url: string | null };

/**
 * No deadline - a branch that never submits just keeps its flagged parts
 * off the Scrapped List forever (they're never approved), which is already
 * the enforcement mechanism. No need for a countdown to block submission on
 * top of that.
 */
export function SubmitDestroyEvidence({
  cycleId,
  branchId,
  cycleMonthLabel,
  status,
  videos,
}: {
  cycleId: string;
  branchId: string;
  cycleMonthLabel: string;
  status: Status;
  videos: Video[];
}) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const locked = status !== "pending";

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    setUploading(true);
    setError(null);
    try {
      const supabase = createClient();
      for (let i = 0; i < files.length; i++) {
        setProgress(`Uploading video ${i + 1} of ${files.length}...`);
        const file = files[i];
        const ext = file.name.split(".").pop() || "bin";
        const path = `destroy-evidence/${branchId}/${cycleId}/video-${Date.now()}-${i}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("warranty-room-files")
          .upload(path, file, { upsert: true, contentType: file.type || undefined });
        if (uploadError) {
          setError(`Upload failed on video ${i + 1}: ${uploadError.message}`);
          return;
        }
        const result = await addDestroyEvidenceVideo(cycleId, path);
        if (result?.error) {
          setError(result.error);
          return;
        }
      }
      router.refresh();
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  function handleDelete(video: Video) {
    if (!window.confirm("Delete this video?")) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteDestroyEvidenceVideo(video.id, video.path);
      if (result?.error) setError(result.error);
      else router.refresh();
    });
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const result = await submitDestroyEvidence(cycleId);
      if (result?.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-neutral-200/70 bg-white shadow-sm p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-900">Submit destroy evidence</h2>
        <span className="text-xs text-neutral-500">{cycleMonthLabel} cycle</span>
      </div>

      {status === "submitted" && <p className="text-sm text-emerald-700">Submitted - awaiting officer approval.</p>}
      {status === "sent" && <p className="text-sm text-neutral-500">Approved - this cycle&apos;s flagged parts were moved to the Scrapped List.</p>}

      {videos.length > 0 && (
        <ul className="space-y-1">
          {videos.map((v, i) => (
            <li key={v.id} className="flex items-center justify-between gap-2 text-sm">
              {v.url ? (
                <a href={v.url} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                  Video {videos.length > 1 ? i + 1 : ""} →
                </a>
              ) : (
                <span className="text-neutral-400">Video {i + 1} unavailable</span>
              )}
              {!locked && (
                <button
                  type="button"
                  onClick={() => handleDelete(v)}
                  disabled={isPending}
                  className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

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
          </div>

          {progress && <p className="text-sm text-neutral-600">{progress}</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}

          {videos.length > 0 && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={uploading || isPending}
              className="rounded-lg bg-brand shadow-sm shadow-brand/25 hover:shadow-md hover:shadow-brand/30 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
            >
              {isPending ? "Submitting..." : "Submit destroy evidence"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
