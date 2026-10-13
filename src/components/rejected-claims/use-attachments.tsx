"use client";

import { useRef, useState } from "react";
import { prepareDriveUploads, type DriveAttachmentInput } from "@/app/actions/rejected-claims";
import { FEEDBACK_ACCEPT, formatBytes, isAllowedFeedbackMime } from "@/lib/feedback-constants";
import { REJECTED_MAX_FILES, REJECTED_MAX_FILE_BYTES } from "@/lib/rejected-claims";

type Picked = { key: string; file: File; driveFileId: string | null };

/** Where the files go: a new entry names its branch and work order; an existing entry just its id. */
export type UploadContext = { entryId: string; branchId?: string; workOrder?: string };

/**
 * Picks files, validates them (photo / PDF / video, 10 MB, at most 5) and, on
 * save, uploads them to the company's Google Drive: the server opens an upload
 * session per file inside Rejected Claims From Workshop / <branch> / <work
 * order>, and the browser sends the bytes straight to Google (a server action
 * body is far too small for 10 MB). A file that already uploaded is remembered,
 * so retrying a failed save never uploads it twice.
 */
export function useAttachments() {
  const [files, setFiles] = useState<Picked[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  function add(list: FileList | null) {
    if (!list) return;
    setError(null);
    const next = [...files];
    for (const file of Array.from(list)) {
      if (next.length >= REJECTED_MAX_FILES) {
        setError(`You can attach at most ${REJECTED_MAX_FILES} files.`);
        break;
      }
      if (!isAllowedFeedbackMime(file.type)) {
        setError(`"${file.name}" is not a photo, PDF or video.`);
        continue;
      }
      if (file.size > REJECTED_MAX_FILE_BYTES) {
        setError(`"${file.name}" is ${formatBytes(file.size)} - the maximum is 10 MB per file.`);
        continue;
      }
      if (file.size === 0) {
        setError(`"${file.name}" is empty.`);
        continue;
      }
      next.push({ key: crypto.randomUUID(), file, driveFileId: null });
    }
    setFiles(next);
    if (input.current) input.current.value = "";
  }

  function remove(key: string) {
    setFiles((current) => current.filter((f) => f.key !== key));
  }

  function reset() {
    setFiles([]);
    setError(null);
    setStatus(null);
  }

  /** Uploads what is not in Drive yet and returns every file's details for saving. */
  async function upload(context: UploadContext): Promise<DriveAttachmentInput[]> {
    const done = new Map<string, string>(files.flatMap((f) => (f.driveFileId ? [[f.key, f.driveFileId] as [string, string]] : [])));
    const pending = files.filter((f) => !f.driveFileId);
    try {
      if (pending.length > 0) {
        setStatus("Preparing the Drive folder...");
        const prepared = await prepareDriveUploads({
          ...context,
          files: pending.map((p) => ({ name: p.file.name, type: p.file.type, size: p.file.size })),
        });
        if (prepared.error || !prepared.uploads) throw new Error(prepared.error ?? "Could not prepare the upload.");

        for (let i = 0; i < pending.length; i++) {
          const { file, key } = pending[i];
          setStatus(`Uploading file ${i + 1} of ${pending.length} to Google Drive...`);
          let res: Response;
          try {
            res = await fetch(prepared.uploads[i].sessionUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
          } catch {
            throw new Error(`"${file.name}" could not be sent to Google Drive - check your connection and try again.`);
          }
          const json = (await res.json().catch(() => null)) as { id?: string } | null;
          if (!res.ok || !json?.id) throw new Error(`Google Drive did not accept "${file.name}" (${res.status}) - please try again.`);
          done.set(key, json.id);
        }
      }
    } finally {
      // Remember the uploads that did succeed, even if a later file failed.
      setFiles((current) => current.map((f) => (done.has(f.key) ? { ...f, driveFileId: done.get(f.key)! } : f)));
      setStatus(null);
    }
    return files.map((f) => ({ driveFileId: done.get(f.key)!, name: f.file.name, type: f.file.type, size: f.file.size }));
  }

  return { files, error, status, input, add, remove, reset, upload, setError, count: files.length };
}

export function AttachmentPicker({
  state,
  disabled,
  driveReady,
}: {
  state: ReturnType<typeof useAttachments>;
  disabled?: boolean;
  /** False until an officer has connected Google Drive - attaching is switched off meanwhile. */
  driveReady: boolean;
}) {
  const { files, input, add, remove } = state;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <input ref={input} type="file" accept={FEEDBACK_ACCEPT} multiple hidden onChange={(e) => add(e.target.files)} />
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={disabled || !driveReady || files.length >= REJECTED_MAX_FILES}
          className="flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 disabled:opacity-50"
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M15.5 9.5l-5.6 5.6a3.5 3.5 0 01-5-5l6-6a2.3 2.3 0 013.3 3.3l-6 6a1.2 1.2 0 01-1.7-1.7l5.4-5.4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Attach photo, PDF or video
        </button>
        <span className="text-xs text-neutral-500">
          {driveReady ? `Saved to the company Google Drive · up to ${REJECTED_MAX_FILES} files, 10 MB each` : "Attachments are unavailable until Google Drive is connected"}
        </span>
      </div>
      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((f) => (
            <li
              key={f.key}
              className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm"
            >
              <span className="min-w-0 truncate text-neutral-800">
                {f.file.name} <span className="text-neutral-500">· {formatBytes(f.file.size)}</span>
                {f.driveFileId && <span className="ml-2 text-xs font-medium text-emerald-700">in Drive</span>}
              </span>
              <button
                type="button"
                onClick={() => remove(f.key)}
                disabled={disabled}
                aria-label={`Remove ${f.file.name}`}
                className="shrink-0 text-xs font-medium text-neutral-500 hover:text-red-600 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
