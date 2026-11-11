"use client";

import { useState, useTransition } from "react";
import { searchWarrantyRoom, type RoomResult, type RoomState } from "@/app/actions/warranty-room-search";
import { CopyText } from "@/components/copy-text";
import { Glyph } from "@/components/ui/glyph";

const TONE: Record<RoomState, string> = {
  holding: "bg-amber-50 text-amber-900 ring-amber-200",
  holding_due: "bg-orange-50 text-orange-900 ring-orange-200",
  not_verified: "bg-amber-50 text-amber-900 ring-amber-200",
  flagged: "bg-red-50 text-red-800 ring-red-200",
  supplier_pending: "bg-blue-50 text-blue-900 ring-blue-200",
  supplier_collected: "bg-neutral-100 text-neutral-700 ring-neutral-200",
  scrapped: "bg-neutral-100 text-neutral-700 ring-neutral-200",
  no_parts: "bg-neutral-50 text-neutral-600 ring-neutral-200",
  not_held: "bg-neutral-50 text-neutral-600 ring-neutral-200",
};
const LABEL: Record<RoomState, string> = {
  holding: "Holding period",
  holding_due: "Holding period over",
  not_verified: "Holding - not verified yet",
  flagged: "Flagged to be scrapped",
  supplier_pending: "Reserved for supplier",
  supplier_collected: "Collected by supplier",
  scrapped: "Already scrapped",
  no_parts: "No parts",
  not_held: "Not held",
};

/** Warranty Room: look up a claim by claim number, work order (WIP) or VIN and see where its part stands. */
export function WarrantyRoomSearch() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ results?: RoomResult[]; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const run = () => start(async () => setRes(await searchWarrantyRoom(q)));

  return (
    <section className="space-y-3 rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a claim - claim number, work order (WIP) or VIN" inputMode="search" className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-sm" aria-label="Claim number, work order or VIN" />
        <button type="submit" disabled={pending || q.trim().length < 4} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
          <Glyph name="search" /> {pending ? "Searching…" : "Search"}
        </button>
      </form>
      {res?.error && <p className="text-sm text-red-700">{res.error}</p>}
      {res?.results && res.results.length === 0 && <p className="text-sm text-neutral-500">No claim found with that number.</p>}
      {res?.results?.map((r) => (
        <div key={r.claimNumber} className={`space-y-2 rounded-lg p-3 ring-1 ${TONE[r.state]}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-bold">{LABEL[r.state]}</span>
            <span className="text-xs">{r.branch}</span>
          </div>
          <p className="text-sm">{r.detail}</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
            <div>
              <dt className="opacity-70">Claim</dt>
              <dd className="font-medium">
                <CopyText value={r.claimNumber} label="claim number" />
              </dd>
            </div>
            <div>
              <dt className="opacity-70">Work order</dt>
              <dd className="font-medium">
                <CopyText value={r.workOrder} label="work order" />
                {r.subDealer && (
                  <span className="ml-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900" title="A Heraa work order done for the sub-dealer.">
                    Sub-Dealer WIP
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="opacity-70">VIN</dt>
              <dd className="font-mono font-medium">
                <CopyText value={r.vin} label="VIN" />
              </dd>
            </div>
            <div>
              <dt className="opacity-70">Claim status · verified</dt>
              <dd className="font-medium">
                {r.claimStatus ?? "—"} · {r.verification ?? "not yet"}
              </dd>
            </div>
          </dl>
          {r.parts.length > 0 && (
            <ul className="space-y-0.5 text-xs">
              {r.parts.map((p, i) => (
                <li key={i}>
                  <span className="font-mono">{p.partNo ?? "—"}</span> {p.name ?? ""} {p.qty != null ? `× ${p.qty}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
