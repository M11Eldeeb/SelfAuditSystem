"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteFeedback, deleteFeedbackAttachments } from "../actions";

const buttonClass =
  "rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 shadow-sm transition-colors hover:bg-red-50 disabled:opacity-50";

/**
 * Two ways to clean up a message: delete only its attachments (frees storage,
 * keeps the text and replies) or delete the whole message.
 */
export function DeleteFeedbackActions({ feedbackId, attachmentCount }: { feedbackId: string; attachmentCount: number }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"attachments" | "all" | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const fileWord = `${attachmentCount} attached file${attachmentCount === 1 ? "" : "s"}`;

  function run(kind: "attachments" | "all") {
    const message =
      kind === "attachments"
        ? `Permanently delete the ${fileWord}? The message and your replies stay. This cannot be undone.`
        : `Permanently delete this whole message${attachmentCount > 0 ? `, its ${fileWord}` : ""} and your replies? The sender will no longer see it either. This cannot be undone.`;
    if (!window.confirm(message)) return;
    setError(null);
    setPending(kind);
    startTransition(async () => {
      const result = kind === "attachments" ? await deleteFeedbackAttachments(feedbackId) : await deleteFeedback(feedbackId);
      setPending(null);
      if (result.error) setError(result.error);
      else if (kind === "all") router.push("/admin/feedbacks");
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        {attachmentCount > 0 && (
          <button type="button" onClick={() => run("attachments")} disabled={pending !== null} className={buttonClass}>
            {pending === "attachments" ? "Deleting..." : "Delete attachments"}
          </button>
        )}
        <button type="button" onClick={() => run("all")} disabled={pending !== null} className={buttonClass}>
          {pending === "all" ? "Deleting..." : "Delete message"}
        </button>
      </div>
      {error && <p className="max-w-[300px] text-right text-xs text-red-600">{error}</p>}
    </div>
  );
}
