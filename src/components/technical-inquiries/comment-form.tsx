"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addInquiryComment, prepareInquiryUploads } from "@/app/actions/technical-inquiries";
import { INQUIRY_MAX_FILES, INQUIRY_MAX_FILE_BYTES, INQUIRY_TEXT_MAX } from "@/lib/technical-inquiries";
import { AttachmentPicker, useAttachments, type PrepareUploads } from "@/components/rejected-claims/use-attachments";

/**
 * Reply on an inquiry (the workshop or the technical team), with photos, PDFs or videos in Google Drive. The technical
 * team can also write an internal note: text only, seen by the technical team and officers, never by the workshop, and it
 * changes nothing about whose turn it is.
 */
export function InquiryCommentForm({ inquiryId, driveReady, placeholder, canWriteInternal }: { inquiryId: string; driveReady: boolean; placeholder: string; canWriteInternal?: boolean }) {
  const router = useRouter();
  const attachments = useAttachments({
    prepare: prepareInquiryUploads as unknown as PrepareUploads,
    maxFiles: INQUIRY_MAX_FILES,
    maxFileBytes: INQUIRY_MAX_FILE_BYTES,
  });
  const [commentId, setCommentId] = useState(() => crypto.randomUUID());
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    if (!body.trim()) return setError("Write your comment.");
    setSaving(true);
    try {
      const uploaded = internal ? [] : await attachments.upload({ inquiryId });
      const result = await addInquiryComment({ id: commentId, inquiryId, body, attachments: uploaded, internal });
      if (result.error) throw new Error(result.error);
      setBody("");
      attachments.reset();
      setCommentId(crypto.randomUUID());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your comment - please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className={`space-y-3 rounded-xl border p-4 shadow-sm ${internal ? "border-amber-300 bg-amber-50/60" : "border-neutral-200/70 bg-white"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor="ti-comment" className="text-xs font-medium text-neutral-700">
          {internal ? "Internal note - the workshop cannot see it" : "Add a comment"}
        </label>
        {canWriteInternal && (
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-neutral-700">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} disabled={saving} className="h-4 w-4 rounded border-neutral-300 text-brand focus:ring-brand/30" />
            Internal note (technical team only)
          </label>
        )}
      </div>
      <textarea
        id="ti-comment"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={INQUIRY_TEXT_MAX}
        rows={3}
        disabled={saving}
        placeholder={internal ? "A note for your colleagues - no mail is sent and the workshop does not see it" : placeholder}
        className="w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm transition-colors placeholder:text-neutral-500 focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none disabled:opacity-60"
      />
      {!internal && <AttachmentPicker state={attachments} disabled={saving} driveReady={driveReady} />}
      {!internal && attachments.error && (
        <p role="alert" className="text-sm text-red-600">
          {attachments.error}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-3">
        {!internal && attachments.status && <span className="text-sm text-neutral-500">{attachments.status}</span>}
        <button
          type="submit"
          disabled={saving || !body.trim()}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition hover:bg-brand-dark disabled:opacity-50"
        >
          {saving ? "Sending..." : internal ? "Save the note" : "Send comment"}
        </button>
      </div>
    </form>
  );
}
