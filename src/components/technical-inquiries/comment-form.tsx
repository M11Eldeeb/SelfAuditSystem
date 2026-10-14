"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addInquiryComment, prepareInquiryUploads } from "@/app/actions/technical-inquiries";
import { INQUIRY_MAX_FILES, INQUIRY_MAX_FILE_BYTES, INQUIRY_TEXT_MAX } from "@/lib/technical-inquiries";
import { AttachmentPicker, useAttachments, type PrepareUploads } from "@/components/rejected-claims/use-attachments";

/** Reply on an inquiry (the workshop or the technical team), with photos, PDFs or videos in Google Drive. */
export function InquiryCommentForm({ inquiryId, driveReady, placeholder }: { inquiryId: string; driveReady: boolean; placeholder: string }) {
  const router = useRouter();
  const attachments = useAttachments({
    prepare: prepareInquiryUploads as unknown as PrepareUploads,
    maxFiles: INQUIRY_MAX_FILES,
    maxFileBytes: INQUIRY_MAX_FILE_BYTES,
  });
  const [commentId, setCommentId] = useState(() => crypto.randomUUID());
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    if (!body.trim()) return setError("Write your comment.");
    setSaving(true);
    try {
      const uploaded = await attachments.upload({ inquiryId });
      const result = await addInquiryComment({ id: commentId, inquiryId, body, attachments: uploaded });
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
    <form onSubmit={handleSave} className="space-y-3 rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
      <label htmlFor="ti-comment" className="text-xs font-medium text-neutral-700">
        Add a comment
      </label>
      <textarea
        id="ti-comment"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={INQUIRY_TEXT_MAX}
        rows={3}
        disabled={saving}
        placeholder={placeholder}
        className="w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm transition-colors placeholder:text-neutral-500 focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none disabled:opacity-60"
      />
      <AttachmentPicker state={attachments} disabled={saving} driveReady={driveReady} />
      {attachments.error && (
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
        {attachments.status && <span className="text-sm text-neutral-500">{attachments.status}</span>}
        <button
          type="submit"
          disabled={saving || !body.trim()}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition hover:bg-brand-dark disabled:opacity-50"
        >
          {saving ? "Sending..." : "Send comment"}
        </button>
      </div>
    </form>
  );
}
