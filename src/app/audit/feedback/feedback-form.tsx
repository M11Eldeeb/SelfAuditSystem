"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  FEEDBACK_ACCEPT,
  FEEDBACK_BODY_MAX,
  FEEDBACK_BUCKET,
  FEEDBACK_MAX_FILES,
  FEEDBACK_MAX_FILE_BYTES,
  FEEDBACK_SUBJECT_MAX,
  formatBytes,
  isAllowedFeedbackMime,
  safeStorageName,
} from "@/lib/feedback-constants";
import { submitFeedback } from "./actions";

type Picked = { key: string; file: File; path: string | null };

const inputClass =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm transition-colors placeholder:text-neutral-400 focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none";

export function FeedbackForm({ userId, senderLabel }: { userId: string; senderLabel: string }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [feedbackId, setFeedbackId] = useState(() => crypto.randomUUID());
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<Picked[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [thanks, setThanks] = useState(false);

  // Files already uploaded but not sent (a failed send is retried with them).
  // Leaving the page without sending takes them back out of storage; a closed
  // tab can't, so a daily job also deletes unreferenced files after 24 hours.
  const filesRef = useRef<Picked[]>([]);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);
  useEffect(
    () => () => {
      const paths = filesRef.current.flatMap((f) => (f.path ? [f.path] : []));
      if (paths.length > 0) void createClient().storage.from(FEEDBACK_BUCKET).remove(paths);
    },
    []
  );

  function addFiles(list: FileList | null) {
    if (!list) return;
    setError(null);
    const next = [...files];
    for (const file of Array.from(list)) {
      if (next.length >= FEEDBACK_MAX_FILES) {
        setError(`You can attach at most ${FEEDBACK_MAX_FILES} files.`);
        break;
      }
      if (!isAllowedFeedbackMime(file.type)) {
        setError(`"${file.name}" is not a photo, PDF or video.`);
        continue;
      }
      if (file.size > FEEDBACK_MAX_FILE_BYTES) {
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
    if (fileInput.current) fileInput.current.value = "";
  }

  async function removeFile(picked: Picked) {
    setFiles((current) => current.filter((f) => f.key !== picked.key));
    // Already uploaded by an earlier failed send: take it back out of storage.
    if (picked.path) await createClient().storage.from(FEEDBACK_BUCKET).remove([picked.path]);
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (sending) return;
    setError(null);
    if (!subject.trim()) return setError("Enter a subject.");
    if (!body.trim()) return setError("Write your message.");

    setSending(true);
    try {
      const supabase = createClient();
      // Upload what is not in storage yet. Kept in a new array (not mutating
      // state) and written back afterwards so a retry after a failed send
      // does not upload the same files twice.
      const uploaded: Picked[] = [];
      try {
        for (let i = 0; i < files.length; i++) {
          const picked = files[i];
          if (picked.path) {
            uploaded.push(picked);
            continue;
          }
          setStatus(`Uploading file ${i + 1} of ${files.length}...`);
          const path = `${userId}/${feedbackId}/${crypto.randomUUID().slice(0, 8)}-${safeStorageName(picked.file.name)}`;
          const { error: uploadError } = await supabase.storage
            .from(FEEDBACK_BUCKET)
            .upload(path, picked.file, { contentType: picked.file.type, upsert: false });
          if (uploadError) throw new Error(`"${picked.file.name}" could not be uploaded: ${uploadError.message}`);
          uploaded.push({ ...picked, path });
        }
      } finally {
        // Remember the uploads that did succeed, even if a later file failed.
        setFiles((current) => current.map((f) => uploaded.find((u) => u.key === f.key) ?? f));
      }

      setStatus("Sending...");
      const result = await submitFeedback({
        id: feedbackId,
        subject,
        body,
        attachments: uploaded.map((f) => ({ path: f.path!, name: f.file.name, type: f.file.type, size: f.file.size })),
      });
      if (result.error) throw new Error(result.error);

      setSubject("");
      setBody("");
      setFiles([]);
      setFeedbackId(crypto.randomUUID());
      setThanks(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your feedback - please try again.");
    } finally {
      setSending(false);
      setStatus(null);
    }
  }

  return (
    <>
      <form onSubmit={handleSend} className="space-y-4 rounded-xl border border-neutral-200/70 bg-white p-5 shadow-sm">
        <p className="text-sm text-neutral-600">
          From <span className="font-medium text-neutral-900">{senderLabel}</span>
        </p>

        <div className="space-y-1.5">
          <label htmlFor="feedback-subject" className="text-xs font-medium text-neutral-700">
            Subject
          </label>
          <input
            id="feedback-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={FEEDBACK_SUBJECT_MAX}
            placeholder="What is this about?"
            disabled={sending}
            className={inputClass}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="feedback-body" className="text-xs font-medium text-neutral-700">
            Message
          </label>
          <textarea
            id="feedback-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={FEEDBACK_BODY_MAX}
            rows={6}
            placeholder="Write your feedback..."
            disabled={sending}
            className={`${inputClass} resize-y`}
          />
          <p className="text-right text-xs text-neutral-500">
            {body.length} / {FEEDBACK_BODY_MAX}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInput}
              type="file"
              accept={FEEDBACK_ACCEPT}
              multiple
              hidden
              onChange={(e) => addFiles(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={sending || files.length >= FEEDBACK_MAX_FILES}
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
            <span className="text-xs text-neutral-500">Up to {FEEDBACK_MAX_FILES} files, 10 MB each</span>
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
                    onClick={() => removeFile(f)}
                    disabled={sending}
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

        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-3">
          {status && <span className="text-sm text-neutral-500">{status}</span>}
          <button
            type="submit"
            disabled={sending}
            className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition hover:bg-brand-dark hover:shadow-md disabled:opacity-60"
          >
            {sending ? "Sending..." : "Send feedback"}
          </button>
        </div>
      </form>

      {thanks && <ThankYou onClose={() => setThanks(false)} />}
    </>
  );
}

function ThankYou({ onClose }: { onClose: () => void }) {
  const doneRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    doneRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="modal-backdrop absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="thanks-title"
        className="modal-card relative w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-7 text-center shadow-2xl"
      >
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 ring-8 ring-emerald-50/60">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <path
              className="check-draw"
              d="M7 14.5l5 5 9-10.5"
              stroke="#059669"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h2 id="thanks-title" className="text-lg font-bold text-neutral-900">
          Thank you for your feedback!
        </h2>
        <p className="mt-1.5 text-sm text-neutral-600">The warranty team has received it. If they reply, you will see it here.</p>
        <button
          ref={doneRef}
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark"
        >
          Done
        </button>
      </div>
    </div>
  );
}
