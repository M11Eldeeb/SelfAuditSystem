"use client";

import { useRef } from "react";
import { prepareInquiryUploads } from "@/app/actions/technical-inquiries";
import { FEEDBACK_ACCEPT, formatBytes, isAllowedFeedbackMime } from "@/lib/feedback-constants";
import { INQUIRY_MAX_FILES, INQUIRY_MAX_FILE_BYTES, INQUIRY_MAX_UPLOAD_BATCH } from "@/lib/technical-inquiries";

/** A file picked in the form. Once it is in Google Drive it keeps its id, so sending the form again never uploads it twice. */
export type PickedFile = { key: string; file: File; driveFileId: string | null };

/**
 * A small "add attachment" box: any number of photos, PDFs or videos (up to INQUIRY_MAX_FILES), each shown with a Remove.
 * Used under every step and for every document the form asks for; the form keeps the files in its own state.
 */
export function FileBox({
  files,
  onChange,
  label = "Add attachment",
  disabled,
  driveReady,
  invalid,
  onError,
}: {
  files: PickedFile[];
  onChange: (next: PickedFile[]) => void;
  label?: string;
  disabled?: boolean;
  /** False until an officer has connected Google Drive - attaching is switched off meanwhile. */
  driveReady: boolean;
  /** Draws the box in red (a required document is missing). */
  invalid?: boolean;
  onError?: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);

  function add(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    for (const file of Array.from(list)) {
      if (next.length >= INQUIRY_MAX_FILES) return onError?.(`You can attach at most ${INQUIRY_MAX_FILES} files here.`);
      if (!isAllowedFeedbackMime(file.type)) {
        onError?.(`"${file.name}" is not a photo, PDF or video.`);
        continue;
      }
      if (file.size === 0) {
        onError?.(`"${file.name}" is empty.`);
        continue;
      }
      if (file.size > INQUIRY_MAX_FILE_BYTES) {
        onError?.(`"${file.name}" is ${formatBytes(file.size)} - the maximum is ${formatBytes(INQUIRY_MAX_FILE_BYTES)} per file.`);
        continue;
      }
      next.push({ key: crypto.randomUUID(), file, driveFileId: null });
    }
    onChange(next);
  }

  return (
    <div className="space-y-1.5">
      <input
        ref={input}
        type="file"
        accept={FEEDBACK_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={disabled || !driveReady || files.length >= INQUIRY_MAX_FILES}
          className={`flex items-center gap-1.5 rounded-lg border bg-white px-2.5 py-1 text-xs font-medium shadow-sm transition-colors hover:bg-neutral-50 disabled:opacity-50 ${invalid ? "border-red-300 text-red-700" : "border-neutral-300 text-neutral-700"}`}
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M15.5 9.5l-5.6 5.6a3.5 3.5 0 01-5-5l6-6a2.3 2.3 0 013.3 3.3l-6 6a1.2 1.2 0 01-1.7-1.7l5.4-5.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {label}
        </button>
        {!driveReady && <span className="text-xs text-neutral-500">Attachments are unavailable until Google Drive is connected</span>}
      </div>
      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f) => (
            <li key={f.key} className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-xs">
              <span className="min-w-0 truncate text-neutral-800">
                {f.file.name} <span className="text-neutral-500">· {formatBytes(f.file.size)}</span>
                {f.driveFileId && <span className="ml-2 font-medium text-emerald-700">in Drive</span>}
              </span>
              <button type="button" onClick={() => onChange(files.filter((x) => x.key !== f.key))} disabled={disabled} aria-label={`Remove ${f.file.name}`} className="shrink-0 font-medium text-neutral-500 hover:text-red-600 disabled:opacity-50">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Sends every file that is not in Google Drive yet: one request opens an upload session per file inside the case's Drive
 * folder, then the browser sends each file straight to Google. `onDone` is called as each file lands, so a failure part
 * way never repeats the files that already made it.
 */
export async function uploadPicked(
  pending: PickedFile[],
  context: Record<string, unknown>,
  onDone: (key: string, driveFileId: string) => void,
  onStatus: (text: string | null) => void
): Promise<void> {
  try {
    let sent = 0;
    for (let start = 0; start < pending.length; start += INQUIRY_MAX_UPLOAD_BATCH) {
      const batch = pending.slice(start, start + INQUIRY_MAX_UPLOAD_BATCH);
      onStatus("Preparing the Drive folder...");
      const prepared = await prepareInquiryUploads({ ...context, inquiryId: String(context.inquiryId), files: batch.map((p) => ({ name: p.file.name, type: p.file.type, size: p.file.size })) });
      if (prepared.error || !prepared.uploads) throw new Error(prepared.error ?? "Could not prepare the upload.");
      for (let i = 0; i < batch.length; i++) {
        const { file, key } = batch[i];
        sent += 1;
        onStatus(`Uploading file ${sent} of ${pending.length} to Google Drive...`);
        let res: Response;
        try {
          res = await fetch(prepared.uploads[i].sessionUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
        } catch {
          throw new Error(`"${file.name}" could not be sent to Google Drive - check your connection and try again.`);
        }
        const json = (await res.json().catch(() => null)) as { id?: string } | null;
        if (!res.ok || !json?.id) throw new Error(`Google Drive did not accept "${file.name}" (${res.status}) - please try again.`);
        onDone(key, json.id);
      }
    }
  } finally {
    onStatus(null);
  }
}
