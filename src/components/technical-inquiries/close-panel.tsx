"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closeTechnicalInquiry, reopenTechnicalInquiry } from "@/app/actions/technical-inquiries";
import { INQUIRY_TEXT_MAX } from "@/lib/technical-inquiries";

/** For the technical team: close the case with a short summary of the solution, or reopen a closed one. */
export function ClosePanel({ inquiryId, closed }: { inquiryId: string; closed: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.error) return setError(res.error);
      setText("");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <section className="space-y-3 rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">{closed ? "This case is closed" : "Finished with this case?"}</h2>
          <p className="text-xs text-neutral-500">
            {closed ? "Reopen it if the workshop needs more help." : "Closing records a summary of the solution and tells the workshop it is done."}
          </p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => (closed ? setOpen(true) : setOpen(true))}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-700"
          >
            {closed ? "Reopen the case" : "Close the case"}
          </button>
        )}
      </div>
      {open && (
        <div className="space-y-2">
          <label htmlFor="ti-close" className="text-xs font-medium text-neutral-700">
            {closed ? "Why is it being reopened? (optional)" : "Summary of the solution"}
          </label>
          <textarea
            id="ti-close"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={INQUIRY_TEXT_MAX}
            rows={3}
            disabled={pending}
            placeholder={closed ? "e.g. The fault came back after the repair" : "What was wrong and what fixed it (part, software, procedure)"}
            className="w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none disabled:opacity-60"
          />
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pending || (!closed && !text.trim())}
              onClick={() => run(() => (closed ? reopenTechnicalInquiry({ inquiryId, comment: text }) : closeTechnicalInquiry({ inquiryId, resolution: text })))}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition hover:bg-brand-dark disabled:opacity-50"
            >
              {pending ? "Saving..." : closed ? "Reopen" : "Close the case"}
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={pending} className="rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100">
              Cancel
            </button>
          </div>
        </div>
      )}
      {!open && error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
