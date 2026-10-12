"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteFeedback } from "../actions";

export function DeleteFeedbackButton({ feedbackId, attachmentCount }: { feedbackId: string; attachmentCount: number }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick() {
    const files = attachmentCount > 0 ? ` and its ${attachmentCount} attached file${attachmentCount === 1 ? "" : "s"}` : "";
    if (
      !window.confirm(
        `Permanently delete this message${files}, and your replies? The sender will no longer see it either. This cannot be undone.`
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const result = await deleteFeedback(feedbackId);
      if (result.error) setError(result.error);
      else router.push("/admin/feedbacks");
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 shadow-sm transition-colors hover:bg-red-50 disabled:opacity-50"
      >
        {isPending ? "Deleting..." : "Delete"}
      </button>
      {error && <p className="max-w-[240px] text-right text-xs text-red-600">{error}</p>}
    </div>
  );
}
