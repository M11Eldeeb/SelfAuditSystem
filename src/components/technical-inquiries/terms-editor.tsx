"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveInquiryTerms } from "@/app/actions/technical-inquiries";
import { INQUIRY_MAX_TERMS, INQUIRY_TERM_MAX } from "@/lib/technical-inquiries";

/** Officers: the terms a workshop must confirm before it can submit an inquiry. One term per line. */
export function TermsEditor({ terms }: { terms: string[] }) {
  const router = useRouter();
  const [text, setText] = useState(terms.join("\n"));
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<{ good: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const lines = text.split("\n").map((t) => t.trim()).filter(Boolean);
  const dirty = lines.join("\n") !== terms.join("\n");

  return (
    <section className="rounded-xl border border-neutral-200/70 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-neutral-50"
      >
        <span className="text-sm font-semibold text-neutral-900">
          Terms the workshop must confirm <span className="font-normal text-neutral-500">({terms.length})</span>
        </span>
        <span className="text-xs font-medium text-brand">{open ? "Close" : "Edit"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-neutral-100 p-4">
          <p className="text-xs text-neutral-500">
            One term per line (up to {INQUIRY_MAX_TERMS}, {INQUIRY_TERM_MAX} characters each). The workshop has to tick every one before it can submit. An inquiry remembers the version it was confirmed against.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={Math.max(5, Math.min(14, lines.length + 2))}
            disabled={pending}
            aria-label="Terms, one per line"
            className="w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm leading-relaxed text-neutral-900 shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none disabled:opacity-60"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={pending || !dirty || lines.length === 0}
              onClick={() =>
                startTransition(async () => {
                  setNote(null);
                  const res = await saveInquiryTerms(lines);
                  setNote(res.error ? { good: false, text: res.error } : { good: true, text: "Saved. Workshops now confirm this list." });
                  if (!res.error) router.refresh();
                })
              }
              className="rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition hover:bg-brand-dark disabled:opacity-50"
            >
              {pending ? "Saving..." : "Save the terms"}
            </button>
            {note && <span className={`text-sm ${note.good ? "text-emerald-700" : "text-red-600"}`}>{note.text}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
