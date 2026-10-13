"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatBytes } from "@/lib/feedback-constants";
import { EVIDENCE_MAX_VIDEOS, EVIDENCE_MAX_VIDEO_BYTES } from "@/lib/warranty-room/evidence-limits";
import {
  addDestroyEvidenceVideos,
  deleteDestroyEvidenceVideo,
  prepareEvidenceUploads,
  submitDestroyEvidence,
  type EvidenceVideoInput,
} from "./destroy-evidence-actions";

type Status = "pending" | "submitted" | "sent";
type Video = { id: string; name: string; size: number; url: string | null };

/** Sends one video straight to Google Drive (an upload session the server opened) and reports progress as 0-1. Resolves to the Drive file id. */
function putToDrive(sessionUrl: string, file: File, onProgress: (fraction: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", sessionUrl);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new Error(`"${file.name}" could not be sent to Google Drive - check your connection and try again.`));
    xhr.onload = () => {
      let id: string | undefined;
      try {
        id = (JSON.parse(xhr.responseText) as { id?: string }).id;
      } catch {
        // handled below
      }
      if (xhr.status >= 200 && xhr.status < 300 && id) resolve(id);
      else reject(new Error(`Google Drive did not accept "${file.name}" (${xhr.status}) - please try again.`));
    };
    xhr.send(file);
  });
}

/**
 * No deadline - a branch that never submits just keeps its flagged parts
 * off the Scrapped List forever (they're never approved), which is already
 * the enforcement mechanism. No need for a countdown to block submission on
 * top of that.
 */
export function SubmitDestroyEvidence({
  cycleId,
  cycleMonthLabel,
  status,
  videos,
}: {
  cycleId: string;
  cycleMonthLabel: string;
  status: Status;
  videos: Video[];
}) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadingFlagged, setDownloadingFlagged] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const locked = status !== "pending";

  async function handleDownloadFlagged() {
    setDownloadingFlagged(true);
    setError(null);
    try {
      const res = await fetch(`/api/warranty-room/download/flagged-to-scrap?cycle=${encodeURIComponent(cycleId)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Could not generate the report (${res.status}).`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? `Flagged_To_Scrap_${cycleMonthLabel}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate the report.");
    } finally {
      setDownloadingFlagged(false);
    }
  }

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setError(null);
    if (videos.length + files.length > EVIDENCE_MAX_VIDEOS) return setError(`You can add at most ${EVIDENCE_MAX_VIDEOS} videos per cycle.`);
    for (const f of files) {
      if (!f.type.startsWith("video/")) return setError(`"${f.name}" is not a video.`);
      if (f.size > EVIDENCE_MAX_VIDEO_BYTES) return setError(`"${f.name}" is ${formatBytes(f.size)} - the maximum is ${formatBytes(EVIDENCE_MAX_VIDEO_BYTES)} per video.`);
    }

    setUploading(true);
    const uploaded: EvidenceVideoInput[] = [];
    let failure: string | null = null;
    try {
      setProgress("Preparing the Drive folder...");
      const prepared = await prepareEvidenceUploads({ cycleId, files: files.map((f) => ({ name: f.name, type: f.type, size: f.size })) });
      if (prepared.error || !prepared.uploads) throw new Error(prepared.error ?? "Could not prepare the upload.");

      for (let i = 0; i < files.length; i++) {
        const label = `Uploading video ${i + 1} of ${files.length} to Google Drive`;
        setProgress(`${label}...`);
        const driveFileId = await putToDrive(prepared.uploads[i].sessionUrl, files[i], (fraction) =>
          setProgress(`${label} - ${Math.round(fraction * 100)}%`)
        );
        uploaded.push({ driveFileId, name: files[i].name, type: files[i].type, size: files[i].size });
      }
    } catch (err) {
      failure = err instanceof Error ? err.message : "The upload failed - please try again.";
    }

    // Keep whatever did reach Drive, even if a later video failed.
    if (uploaded.length > 0) {
      setProgress("Saving...");
      const saved = await addDestroyEvidenceVideos(cycleId, uploaded);
      if (saved.error) failure = saved.error;
    }
    setUploading(false);
    setProgress(null);
    if (failure) setError(failure);
    router.refresh();
  }

  function handleDelete(video: Video) {
    if (!window.confirm("Delete this video?")) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteDestroyEvidenceVideo(video.id);
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

      <button
        type="button"
        onClick={handleDownloadFlagged}
        disabled={downloadingFlagged}
        className="text-sm font-medium text-brand hover:underline disabled:opacity-50"
      >
        {downloadingFlagged ? "Preparing..." : `Flagged to be scrapped - Cycle ${cycleMonthLabel} →`}
      </button>

      {status === "submitted" && <p className="text-sm text-emerald-700">Submitted - awaiting officer approval.</p>}
      {status === "sent" && <p className="text-sm text-neutral-500">Approved - this cycle&apos;s flagged parts were moved to the Already Scrapped List.</p>}

      {videos.length > 0 && (
        <ul className="space-y-1">
          {videos.map((v, i) => (
            <li key={v.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-neutral-800">
                {v.name || `Video ${i + 1}`} <span className="text-neutral-500">· {formatBytes(v.size)}</span>
                {v.url && (
                  <a href={v.url} target="_blank" rel="noreferrer" className="ml-2 font-medium text-brand hover:underline">
                    Open on Google Drive
                  </a>
                )}
              </span>
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
              One or more videos covering everything scrapped this month - one submission per branch, not per claim. They are saved
              in the company Google Drive (up to {EVIDENCE_MAX_VIDEOS} videos, {formatBytes(EVIDENCE_MAX_VIDEO_BYTES)} each).
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
