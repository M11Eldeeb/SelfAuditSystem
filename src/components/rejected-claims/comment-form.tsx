"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addRejectedClaimComment } from "@/app/actions/rejected-claims";
import { REJECTED_COMMENT_MAX } from "@/lib/rejected-claims";
import { AttachmentPicker, useAttachments } from "./use-attachments";

/** Add a comment (and files) to an entry, any time. Comments cannot be edited or deleted afterwards. */
export function CommentForm({ entryId, branchId }: { entryId: string; branchId: string }) {
  const router = useRouter();
  const attachments = useAttachments();
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
      const uploaded = await attachments.upload(`${branchId}/${entryId}`);
      const result = await addRejectedClaimComment({ id: commentId, entryId, body, attachments: uploaded });
      if (result.error) throw new Error(result.error);
      setBody("");
      attachments.reset();
      setCommentId(crypto.randomUUID());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your comment - please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-3 rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
      <label htmlFor="rc-comment" className="text-xs font-medium text-neutral-700">
        Add a comment
      </label>
      <textarea
        id="rc-comment"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={REJECTED_COMMENT_MAX}
        rows={3}
        disabled={saving}
        placeholder="Add an update, a customer call, new evidence..."
        className="w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm transition-colors placeholder:text-neutral-500 focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none disabled:opacity-60"
      />
      <AttachmentPicker state={attachments} disabled={saving} />
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
          {saving ? "Saving..." : "Add comment"}
        </button>
      </div>
    </form>
  );
}
