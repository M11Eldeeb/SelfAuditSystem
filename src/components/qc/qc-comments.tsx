"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addQcComment } from "@/app/actions/qc-comments";
import type { QcComment } from "@/lib/qc/supervisor";

const ROLE: Record<string, string> = { quality_supervisor: "Quality supervisor", officer: "Warranty officer" };
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" });

/** The comments on a QC report; the quality supervisor and the warranty officers can add one. */
export function QcComments({ checkId, comments, canComment }: { checkId: string; comments: QcComment[]; canComment: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!comments.length && !canComment) return null;

  const send = () =>
    start(async () => {
      setError(null);
      const r = await addQcComment(checkId, text);
      if (r.error) return setError(r.error);
      setText("");
      router.refresh();
    });

  return (
    <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70 sm:p-5">
      <h2 className="text-sm font-bold text-neutral-900">
        Comments <span className="font-medium text-neutral-400">· {comments.length}</span>
      </h2>
      {comments.length > 0 && (
        <ul className="mt-3 space-y-2.5">
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg bg-neutral-50 px-3 py-2.5 ring-1 ring-neutral-200">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
                <span className="font-semibold text-neutral-800">
                  {c.author}
                  {c.role && ROLE[c.role] ? <span className="font-normal text-neutral-500"> · {ROLE[c.role]}</span> : null}
                </span>
                <span className="text-neutral-500">{when(c.at)}</span>
              </div>
              <p className="mt-1 text-sm whitespace-pre-wrap text-neutral-900">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      {canComment && (
        <div className="mt-3 space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder="Write a comment on this QC report"
            aria-label="Comment"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-red-700">{error}</span>
            <button type="button" onClick={send} disabled={pending || !text.trim()} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
              {pending ? "Saving…" : "Add comment"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
