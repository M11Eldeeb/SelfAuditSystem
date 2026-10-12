"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  FEEDBACK_ACCEPT,
  formatBytes,
  isAllowedFeedbackMime,
  safeStorageName,
} from "@/lib/feedback-constants";
import { REJECTED_BUCKET, REJECTED_MAX_FILES, REJECTED_MAX_FILE_BYTES } from "@/lib/rejected-claims";

type Picked = { key: string; file: File; path: string | null };
export type UploadedAttachment = { path: string; name: string; type: string; size: number };

/**
 * Picks files, validates them (photo / PDF / video, 10 MB, at most 5) and
 * uploads them straight to the private bucket under `prefix` (a server action
 * body is far too small for 10 MB files). A file that already uploaded is
 * remembered, so retrying a failed save never uploads it twice. The diary is a
 * permanent record, so users cannot delete from storage: a file that is picked
 * but never saved is swept up by the daily cleanup job.
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
      next.push({ key: crypto.randomUUID(), file, path: null });
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

  /** Uploads what is not in storage yet and returns every file's details for saving. */
  async function upload(prefix: string): Promise<UploadedAttachment[]> {
    const supabase = createClient();
    const done: Picked[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const picked = files[i];
        if (picked.path) {
          done.push(picked);
          continue;
        }
        setStatus(`Uploading file ${i + 1} of ${files.length}...`);
        const path = `${prefix}/${crypto.randomUUID().slice(0, 8)}-${safeStorageName(picked.file.name)}`;
        const { error: uploadError } = await supabase.storage
          .from(REJECTED_BUCKET)
          .upload(path, picked.file, { contentType: picked.file.type, upsert: false });
        if (uploadError) throw new Error(`"${picked.file.name}" could not be uploaded: ${uploadError.message}`);
        done.push({ ...picked, path });
      }
    } finally {
      // Remember the uploads that did succeed, even if a later file failed.
      setFiles((current) => current.map((f) => done.find((d) => d.key === f.key) ?? f));
      setStatus(null);
    }
    return done.map((d) => ({ path: d.path!, name: d.file.name, type: d.file.type, size: d.file.size }));
  }

  return { files, error, status, input, add, remove, reset, upload, setError, count: files.length };
}

export function AttachmentPicker({
  state,
  disabled,
}: {
  state: ReturnType<typeof useAttachments>;
  disabled?: boolean;
}) {
  const { files, input, add, remove } = state;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <input ref={input} type="file" accept={FEEDBACK_ACCEPT} multiple hidden onChange={(e) => add(e.target.files)} />
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={disabled || files.length >= REJECTED_MAX_FILES}
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
        <span className="text-xs text-neutral-500">Up to {REJECTED_MAX_FILES} files, 10 MB each</span>
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
