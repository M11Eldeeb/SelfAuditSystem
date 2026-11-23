"use client";

import { useState } from "react";
import { searchOtherApplication, type SheetHit } from "@/app/actions/courtesy-fleet";

/** A button that opens a search over the other application's agreements (the courtesy cars sheet). */
export function SheetSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SheetHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    const r = await searchOtherApplication(q);
    setBusy(false);
    if (r.error) return setError(r.error);
    setHits(r.hits ?? []);
  };
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm font-semibold text-neutral-800 shadow-sm hover:bg-neutral-50">
        Search the other application
      </button>
    );
  return (
    <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold text-neutral-900">Search the other application (courtesy cars sheet)</h2>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-neutral-500 hover:text-neutral-800" aria-label="Close">
          ✕
        </button>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Plate, customer, WIP or agreement number" className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
        <button type="submit" disabled={busy} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "Searching…" : "Search"}
        </button>
      </form>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {hits && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-[11px] font-semibold tracking-wide text-neutral-500 uppercase">
              <tr>
                <th className="px-2 py-1.5">Agreement</th>
                <th className="px-2 py-1.5">Car</th>
                <th className="px-2 py-1.5">Customer</th>
                <th className="px-2 py-1.5">WIP</th>
                <th className="px-2 py-1.5">Out</th>
                <th className="px-2 py-1.5">Back</th>
                <th className="px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {hits.map((h, i) => (
                <tr key={i}>
                  <td className="px-2 py-1.5 font-mono text-xs">{h.agreement || "—"}</td>
                  <td className="px-2 py-1.5 font-semibold">{h.plate || "—"}</td>
                  <td className="px-2 py-1.5">{h.customer || "—"}</td>
                  <td className="px-2 py-1.5">{h.wip || "—"}</td>
                  <td className="px-2 py-1.5 text-xs">{h.out || "—"}</td>
                  <td className="px-2 py-1.5 text-xs">{h.back || "—"}</td>
                  <td className="px-2 py-1.5 text-xs">
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${h.open ? "bg-blue-50 text-blue-800" : "bg-neutral-100 text-neutral-600"}`}>{h.open ? "Open" : h.status || "Closed"}</span>
                    {h.branch && <span className="ml-1 text-neutral-500">{h.branch}</span>}
                  </td>
                  <td className="px-2 py-1.5">
                    <a href={`/api/courtesy/sheet/${h.idx}/pdf?ref=${encodeURIComponent(h.agreement || h.plate)}`} target="_blank" rel="noreferrer" className="rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-white hover:bg-brand-dark">
                      Print PDF
                    </a>
                  </td>
                </tr>
              ))}
              {hits.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-2 py-4 text-center text-neutral-500">
                    Nothing found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
