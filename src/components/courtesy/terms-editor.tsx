"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveCourtesyTerms } from "@/app/actions/courtesy-fleet";

type Term = { en: string; ar: string };

/** The branch's courtesy car terms, editable (English and Arabic side by side); saving makes a new version. */
export function TermsEditor({ branchId, initial, canEdit }: { branchId: string; initial: Term[]; canEdit: boolean }) {
  const router = useRouter();
  const [terms, setTerms] = useState<Term[]>(initial);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const changed = JSON.stringify(terms) !== JSON.stringify(initial);
  const set = (i: number, p: Partial<Term>) => setTerms((cur) => cur.map((t, j) => (j === i ? { ...t, ...p } : t)));
  const move = (i: number, d: -1 | 1) =>
    setTerms((cur) => {
      const n = [...cur];
      const j = i + d;
      if (j < 0 || j >= n.length) return cur;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const area = "w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-2 text-sm leading-relaxed disabled:bg-neutral-50";
  const small = "rounded-md px-2 py-1 text-xs font-semibold text-neutral-600 ring-1 ring-black/10 hover:bg-neutral-50 disabled:opacity-40";

  return (
    <div className="space-y-3">
      <ol className="space-y-3">
        {terms.map((t, i) => (
          <li key={i} className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-neutral-200/70">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-bold text-neutral-900">Term {i + 1}</span>
              {canEdit && (
                <span className="flex gap-1">
                  <button type="button" className={small} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                    ↑
                  </button>
                  <button type="button" className={small} disabled={i === terms.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                    ↓
                  </button>
                  <button type="button" className={`${small} text-red-700`} onClick={() => window.confirm(`Remove term ${i + 1}?`) && setTerms((cur) => cur.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </span>
              )}
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <textarea rows={4} className={area} value={t.en} disabled={!canEdit} onChange={(e) => set(i, { en: e.target.value })} aria-label={`Term ${i + 1} in English`} placeholder="English" />
              <textarea rows={4} dir="rtl" lang="ar" className={area} value={t.ar} disabled={!canEdit} onChange={(e) => set(i, { ar: e.target.value })} aria-label={`Term ${i + 1} in Arabic`} placeholder="العربية" />
            </div>
          </li>
        ))}
      </ol>
      {canEdit && (
        <div className="sticky bottom-3 space-y-2 rounded-xl bg-white/95 p-3 shadow-lg ring-1 ring-neutral-200 backdrop-blur">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold" onClick={() => setTerms((cur) => [...cur, { en: "", ar: "" }])}>
              + Add a term
            </button>
            {changed && (
              <button type="button" className="rounded-lg px-3 py-2 text-sm font-semibold text-neutral-600" onClick={() => setTerms(initial)}>
                Undo my changes
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <input className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm" placeholder="What did you change? (required, kept in the history)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button
              type="button"
              disabled={busy || !changed}
              onClick={async () => {
                setBusy(true);
                setMsg(null);
                const r = await saveCourtesyTerms(branchId, terms, note);
                setBusy(false);
                if (r.error) return setMsg({ ok: false, text: r.error });
                setMsg({ ok: true, text: `Saved as version ${r.version}. New customer requests use it.` });
                setNote("");
                router.refresh();
              }}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save new version"}
            </button>
          </div>
          {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>}
        </div>
      )}
    </div>
  );
}
