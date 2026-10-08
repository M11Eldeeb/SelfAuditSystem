"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PartReturnItem } from "@/lib/part-returns";
import type { PartFlag } from "@/lib/part-return-flags";
import { FlagBadges } from "@/components/part-returns/flag-badges";
import { closeBranchPartReturn } from "../actions";

const input =
  "block w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none";

export function BranchRequestForm({ requestId, items, flags = {} }: { requestId: string; items: PartReturnItem[]; flags?: Record<string, PartFlag[]> }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Parts ticked for the box label - all by default.
  const [printSel, setPrintSel] = useState<Set<string>>(new Set(items.map((i) => i.id)));
  // itemId -> justification, for parts that can't be found.
  const [missing, setMissing] = useState<Map<string, string>>(new Map());
  const [waybill, setWaybill] = useState("");

  const togglePrint = (id: string) =>
    setPrintSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const toggleMissing = (id: string) =>
    setMissing((m) => {
      const n = new Map(m);
      if (n.has(id)) n.delete(id);
      else n.set(id, "");
      return n;
    });

  const sending = items.filter((i) => !missing.has(i.id));
  const printIds = items.filter((i) => printSel.has(i.id) && !missing.has(i.id)).map((i) => i.id);

  const submit = () => {
    const msg = sending.length
      ? `Close this request? ${sending.length} part(s) dispatched under waybill ${waybill || "(none)"}${missing.size ? `, ${missing.size} missing` : ""}.`
      : `Close this request with all ${missing.size} part(s) missing?`;
    if (!window.confirm(msg)) return;
    setError(null);
    startTransition(async () => {
      const res = await closeBranchPartReturn(requestId, {
        waybill,
        missing: [...missing.entries()].map(([itemId, reason]) => ({ itemId, reason })),
      });
      if (res.error) setError(res.error);
      else router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      {items.some((i) => flags[i.id]?.some((f) => f.kind === "flagged")) && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <strong>Do not scrap</strong> the parts marked “Flagged to scrap” - the warranty team needs them back for the manufacturer.
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-neutral-200/70 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label="Select all for printing"
                  checked={printSel.size === items.length}
                  onChange={(e) => setPrintSel(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())}
                  className="accent-brand"
                />
              </th>
              <th className="px-3 py-2">Claim</th>
              <th className="px-3 py-2">Part</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2">Missing?</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {items.map((i) => {
              const isMissing = missing.has(i.id);
              return (
                <tr key={i.id} className={`align-top ${isMissing ? "bg-red-50/40" : "hover:bg-neutral-50"}`}>
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="Include on label"
                      disabled={isMissing}
                      checked={printSel.has(i.id) && !isMissing}
                      onChange={() => togglePrint(i.id)}
                      className="accent-brand"
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="font-semibold text-neutral-900">{i.claim_number}</div>
                    <div className="text-xs text-neutral-500">
                      {i.work_order_no} · <span className="font-mono">{i.vin}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div>
                      {i.part_name ?? "—"}
                      <FlagBadges flags={flags[i.id]} />
                    </div>
                    <div className="font-mono text-xs text-neutral-500">{i.part_no}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right">{i.quantity ?? 1}</td>
                  <td className="w-80 px-3 py-2.5">
                    <label className="flex items-center gap-1.5 text-xs font-medium text-neutral-700">
                      <input type="checkbox" checked={isMissing} onChange={() => toggleMissing(i.id)} className="accent-red-600" />
                      Part missing
                    </label>
                    {isMissing && (
                      <textarea
                        value={missing.get(i.id)}
                        onChange={(e) => setMissing((m) => new Map(m).set(i.id, e.target.value))}
                        rows={2}
                        placeholder="Justification (required)"
                        className={`mt-1 ${input} text-xs`}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
        <a
          href={printIds.length ? `/audit/part-returns/${requestId}/print?items=${printIds.join(",")}` : undefined}
          target="_blank"
          aria-disabled={!printIds.length}
          className={`rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium shadow-sm ${
            printIds.length ? "text-neutral-800 hover:bg-neutral-50" : "pointer-events-none text-neutral-400"
          }`}
        >
          Print label ({printIds.length} parts)
        </a>
        {sending.length > 0 && (
          <label className="min-w-56 flex-1 space-y-1">
            <span className="text-xs font-medium text-neutral-700">Waybill number</span>
            <input value={waybill} onChange={(e) => setWaybill(e.target.value)} className={input} />
          </label>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={isPending}
          className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition hover:bg-brand-dark disabled:opacity-50"
        >
          {isPending ? "Closing…" : sending.length ? "Close - dispatched to warranty team" : "Close - all parts missing"}
        </button>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
