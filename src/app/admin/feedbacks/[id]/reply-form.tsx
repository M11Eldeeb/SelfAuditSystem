"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FEEDBACK_BODY_MAX } from "@/lib/feedback-constants";
import { replyToFeedback } from "../actions";

export function ReplyForm({ feedbackId }: { feedbackId: string }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSent(false);
    startTransition(async () => {
      const result = await replyToFeedback(feedbackId, text);
      if (result.error) {
        setError(result.error);
        return;
      }
      setText("");
      setSent(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
      <label htmlFor="feedback-reply" className="text-xs font-medium text-neutral-700">
        Reply to the sender
      </label>
      <textarea
        id="feedback-reply"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={FEEDBACK_BODY_MAX}
        rows={4}
        disabled={isPending}
        placeholder="Write your reply..."
        className="w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm transition-colors placeholder:text-neutral-400 focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
      />
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-3">
        {sent && !isPending && <span className="text-sm text-emerald-700">Reply sent.</span>}
        <button
          type="submit"
          disabled={isPending || !text.trim()}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition hover:bg-brand-dark disabled:opacity-50"
        >
          {isPending ? "Sending..." : "Send reply"}
        </button>
      </div>
    </form>
  );
}
