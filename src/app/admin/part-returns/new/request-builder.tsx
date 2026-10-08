"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPartReturns, lookupClaims, type LookupClaim, type NewItem } from "../actions";

const input =
  "rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm shadow-sm transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none";

const partKey = (claimId: string, idx: number) => `${claimId}:${idx}`;

export function RequestBuilder({ branches }: { branches: { id: string; name: string }[] }) {
  const router = useRouter();
  const [branchId, setBranchId] = useState("");
  const [text, setText] = useState("");
  const [claims, setClaims] = useState<LookupClaim[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [notFound, setNotFound] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLooking, startLookup] = useTransition();
  const [isSending, startSend] = useTransition();

  const add = () => {
    setError(null);
    startLookup(async () => {
      const res = await lookupClaims(text, branchId || null);
      if (res.error) setError(res.error);
      setNotFound(res.notFound);
      const have = new Set(claims.map((c) => c.claimId));
      const fresh = res.claims.filter((c) => !have.has(c.claimId));
      setClaims((prev) => [...prev, ...fresh]);
      // New claims come in with every part ticked - untick what isn't needed.
      setSelected((s) => {
        const n = new Set(s);
        for (const c of fresh) c.parts.forEach((_, i) => n.add(partKey(c.claimId, i)));
        return n;
      });
      if (res.claims.length) setText("");
    });
  };

  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const remove = (claimId: string) => {
    setClaims((cs) => cs.filter((c) => c.claimId !== claimId));
    setSelected((s) => new Set([...s].filter((k) => !k.startsWith(`${claimId}:`))));
  };

  const items: NewItem[] = useMemo(
    () =>
      claims.flatMap((c) =>
        c.parts
          .map((p, i) => ({ p, i }))
          .filter(({ i }) => selected.has(partKey(c.claimId, i)))
          .map(({ p }) => ({
            claimId: c.claimId,
            branchId: c.branchId,
            claimNumber: c.claimNumber,
            workOrderNo: c.workOrderNo,
            vin: c.vin,
            claimAmount: c.claimAmount,
            partNo: p.partNo,
            partName: p.partName,
            quantity: p.quantity,
          }))
      ),
    [claims, selected]
  );
  const branchCount = new Set(items.map((i) => i.branchId)).size;

  const send = () => {
    if (!items.length) return;
    if (!window.confirm(`Send ${items.length} part(s) to ${branchCount} branch(es)?`)) return;
    setError(null);
    startSend(async () => {
      const res = await createPartReturns(items, note);
      if (res.error) setError(res.error);
      else router.push("/admin/part-returns?status=open");
    });
  };

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <span className="text-xs font-medium text-neutral-700">Branch</span>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={`block ${input}`}>
              <option value="">Any branch (detected from the claim)</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-72 flex-1 space-y-1">
            <span className="text-xs font-medium text-neutral-700">Claim numbers (one per line, or separated by commas / spaces)</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              placeholder="WSA6P20260908047&#10;WSA6P20260618024"
              className={`block w-full font-mono ${input}`}
            />
          </label>
          <button
            type="button"
            onClick={add}
            disabled={isLooking || !text.trim()}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-50"
          >
            {isLooking ? "Looking up…" : "Add claims"}
          </button>
        </div>
        {notFound.length > 0 && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Not found{branchId ? " in this branch" : ""}: <span className="font-mono">{notFound.join(", ")}</span>
          </p>
        )}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>

      {claims.length > 0 && (
        <div className="space-y-3">
          {claims.map((c) => (
            <div key={c.claimId} className="rounded-xl border border-neutral-200/70 bg-white shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-100 px-4 py-3">
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
                  <div>
                    <div className="text-[11px] font-semibold text-neutral-500 uppercase">Claim</div>
                    <div className="font-semibold text-neutral-900">{c.claimNumber}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-neutral-500 uppercase">Branch / work order</div>
                    <div>
                      {c.branchName} · {c.workOrderNo ?? "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-neutral-500 uppercase">VIN / model</div>
                    <div className="font-mono text-xs">{c.vin ?? "—"}</div>
                    <div className="text-xs text-neutral-500">{c.vehicleModel ?? ""}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-neutral-500 uppercase">Labor · amount</div>
                    <div className="truncate text-xs" title={c.laborName ?? undefined}>
                      {c.laborName ?? "—"}
                    </div>
                    <div className="text-xs font-semibold">{c.claimAmount?.toLocaleString("en-US", { minimumFractionDigits: 2 }) ?? "—"}</div>
                  </div>
                </div>
                <button type="button" onClick={() => remove(c.claimId)} className="text-xs font-medium text-red-600 hover:text-red-800">
                  Remove
                </button>
              </div>
              {c.parts.length === 0 ? (
                <p className="px-4 py-3 text-sm text-neutral-500">No parts recorded on this claim.</p>
              ) : (
                <ul className="divide-y divide-neutral-100">
                  {c.parts.map((p, i) => {
                    const key = partKey(c.claimId, i);
                    return (
                      <li key={key}>
                        <label className="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm hover:bg-neutral-50">
                          <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} className="accent-brand" />
                          <span className="w-32 font-mono text-xs text-neutral-600">{p.partNo ?? "—"}</span>
                          <span className="flex-1">{p.partName ?? "—"}</span>
                          <span className="text-xs text-neutral-500">Qty {p.quantity ?? 1}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}

          <div className="sticky bottom-4 flex flex-wrap items-end gap-3 rounded-xl border border-neutral-200/70 bg-white p-4 shadow-lg">
            <label className="min-w-72 flex-1 space-y-1">
              <span className="text-xs font-medium text-neutral-700">Note to branch (optional, e.g. manufacturer reference)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} className={`block w-full ${input}`} />
            </label>
            <div className="text-sm text-neutral-600">
              <strong className="text-neutral-900">{items.length}</strong> parts · {new Set(items.map((i) => i.claimId)).size} claims · {branchCount} branch
              {branchCount === 1 ? "" : "es"}
            </div>
            <button
              type="button"
              onClick={send}
              disabled={isSending || items.length === 0}
              className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition hover:bg-brand-dark disabled:opacity-50"
            >
              {isSending ? "Sending…" : "Send to branch"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
