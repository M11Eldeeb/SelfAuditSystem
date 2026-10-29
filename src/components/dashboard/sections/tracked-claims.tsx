"use client";

import { useCallback, useEffect, useState } from "react";
import { addTrackedClaims, getTrackedClaims, removeTrackedClaim, updateTrackedClaim, type TrackedClaim, type TrackedClaimsData } from "@/app/admin/dashboard/tracked-claims-actions";
import { Panel, Pill, fmtDate, fmtMoney } from "@/components/dashboard/ui";
import { CarLoaderCard } from "@/components/spinner";
import { Glyph } from "@/components/ui/glyph";

const statusTone = (s: string | null): "good" | "warn" | "bad" | "muted" | "blue" =>
  !s ? "muted" : /settled|closed/i.test(s) ? "good" : /reject|return/i.test(s) ? "bad" : /draft/i.test(s) ? "muted" : "blue";

/** One tracked claim: its data (or "waiting for the next upload"), a note and the completed tick. */
function Row({ r, cur, canEdit, onChanged }: { r: TrackedClaim; cur: string; canEdit: boolean; onChanged: (patch: Partial<TrackedClaim> | null) => void }) {
  const [note, setNote] = useState(r.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = note.trim() !== (r.note ?? "");

  async function save(patch: { note?: string | null; completed?: boolean }) {
    setBusy(true);
    setError(null);
    const res = await updateTrackedClaim(r.claimNumber, patch);
    setBusy(false);
    if (res.error) return setError(res.error);
    onChanged(patch.completed === undefined ? { note: patch.note ?? null } : { completed: patch.completed, completedAt: patch.completed ? new Date().toISOString() : null });
  }
  async function remove() {
    if (!window.confirm(`Stop tracking ${r.claimNumber}?`)) return;
    setBusy(true);
    const res = await removeTrackedClaim(r.claimNumber);
    setBusy(false);
    if (res.error) setError(res.error);
    else onChanged(null);
  }

  const c = r.claim;
  return (
    <tr className={`align-top ${r.completed ? "opacity-60" : ""}`}>
      <td className="py-3 pr-3">
        <div className="font-mono text-[13px] font-semibold text-[#1d1d1f] select-all">{r.claimNumber}</div>
        <div className="text-[11px] text-[#8e8e93]">
          added {fmtDate(r.addedAt)}
          {r.addedBy ? ` · ${r.addedBy}` : ""}
        </div>
      </td>
      {c ? (
        <>
          <td className="px-3 py-3">
            <Pill tone={statusTone(c.status)}>{c.status ?? "No status"}</Pill>
            {c.firstSubmit && <div className="mt-1 text-[11px] text-[#8e8e93]">first submit {fmtDate(c.firstSubmit)}</div>}
          </td>
          <td className="max-w-[14rem] px-3 py-3 text-[13px] text-[#3a3a3c]">{c.mainPart ?? "—"}</td>
          <td className="px-3 py-3 font-mono text-[12px] whitespace-nowrap">{c.workOrder ?? "—"}</td>
          <td className="px-3 py-3 text-right text-[13px] font-semibold whitespace-nowrap tabular-nums">{c.total == null ? "—" : `${fmtMoney(c.total)} ${cur}`}</td>
          <td className="px-3 py-3 text-[13px] whitespace-nowrap">{c.branch ?? "—"}</td>
        </>
      ) : (
        <td colSpan={5} className="px-3 py-3 text-[13px] text-[#8e8e93]">
          Not in the claims data yet - it appears after the next claims upload.
        </td>
      )}
      <td className="w-72 px-3 py-3">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={!canEdit || busy}
          rows={2}
          placeholder="Note"
          className="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-[13px] disabled:bg-neutral-50"
        />
        {dirty && canEdit && (
          <button type="button" disabled={busy} onClick={() => void save({ note })} className="mt-1 rounded-md bg-neutral-900 px-2.5 py-1 text-[12px] font-semibold text-white disabled:opacity-50">
            Save note
          </button>
        )}
        {error && <p className="mt-1 text-[12px] text-red-700">{error}</p>}
      </td>
      <td className="py-3 pl-3 text-right whitespace-nowrap">
        {canEdit && (
          <div className="flex flex-col items-end gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => void save({ completed: !r.completed })}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] font-semibold disabled:opacity-50 ${r.completed ? "bg-neutral-900/[0.06] text-neutral-700" : "bg-[#248a3d] text-white"}`}
            >
              <Glyph name="check" /> {r.completed ? "Reopen" : "Completed"}
            </button>
            <button type="button" disabled={busy} onClick={() => void remove()} className="text-[12px] text-neutral-500 underline">
              Remove
            </button>
          </div>
        )}
        {r.completed && r.completedAt && (
          <div className="mt-1 text-[11px] text-[#8e8e93]">
            done {fmtDate(r.completedAt)}
            {r.completedBy ? ` · ${r.completedBy}` : ""}
          </div>
        )}
      </td>
    </tr>
  );
}

/**
 * Reconciliation > Claims to review: the officer adds claim numbers to follow (e.g. a claim just submitted). Each shows
 * its status, main part, work order, total and branch from the latest claims upload - a claim not uploaded yet waits
 * for the next batch - with a note and a completed tick.
 */
export function TrackedClaimsSection({ currency }: { currency: string }) {
  const [data, setData] = useState<TrackedClaimsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [note, setNote] = useState("");
  const [view, setView] = useState<"open" | "done" | "all">("open");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(() => {
    getTrackedClaims()
      .then(setData)
      .catch(() => setError("Could not load the tracked claims."));
  }, []);
  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  async function add() {
    setBusy(true);
    setMsg(null);
    const r = await addTrackedClaims(input, note);
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: r.error });
    setMsg({ ok: true, text: r.added ? `${r.added} claim${r.added === 1 ? "" : "s"} added.` : "Already tracked." });
    setInput("");
    setNote("");
    load();
  }

  if (error) return <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (!data) return <CarLoaderCard height="h-80" label="Loading tracked claims…" />;

  const patchRow = (n: string, patch: Partial<TrackedClaim> | null) =>
    setData((d) => (d ? { ...d, rows: patch ? d.rows.map((r) => (r.claimNumber === n ? { ...r, ...patch } : r)) : d.rows.filter((r) => r.claimNumber !== n) } : d));
  const open = data.rows.filter((r) => !r.completed);
  const waiting = open.filter((r) => !r.claim).length;
  const needle = q.trim().toUpperCase();
  const shown = (view === "open" ? open : view === "done" ? data.rows.filter((r) => r.completed) : data.rows).filter(
    (r) => !needle || r.claimNumber.includes(needle) || (r.claim?.workOrder ?? "").toUpperCase().includes(needle) || (r.note ?? "").toUpperCase().includes(needle)
  );

  return (
    <div className="space-y-4">
      {data.canEdit && (
        <Panel title="Track claims" subtitle="Paste one or more claim numbers (separated by spaces, commas or new lines).">
          <div className="flex flex-wrap items-start gap-2">
            <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} placeholder="WSA6P20261028001" className="min-w-[16rem] flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-[13px]" />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="min-w-[12rem] flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-[13px]" />
            <button type="button" disabled={busy || !input.trim()} onClick={() => void add()} className="rounded-lg bg-brand px-4 py-2 text-[13px] font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
              <Glyph name="plus" /> Add
            </button>
          </div>
          {msg && <p className={`mt-2 text-[13px] ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>}
        </Panel>
      )}

      <Panel
        title="Claims to review"
        subtitle={`Claims data as of the last upload${data.lastUpload ? ` (${fmtDate(data.lastUpload)})` : ""}${waiting ? ` · ${waiting} waiting for the next upload` : ""}`}
        action={<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search claim, work order, note" className="w-56 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-[13px]" />}
      >
        <div className="mb-3 flex flex-wrap gap-2">
          {(["open", "done", "all"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} className={`rounded-full px-3 py-1 text-xs font-semibold ${view === v ? "bg-neutral-900 text-white" : "bg-white text-neutral-600 ring-1 ring-neutral-200"}`}>
              {v === "open" ? `Open (${open.length})` : v === "done" ? `Completed (${data.rows.length - open.length})` : `All (${data.rows.length})`}
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="py-8 text-center text-[14px] text-[#6e6e73]">{data.rows.length ? "Nothing here." : "No claims tracked yet - add a claim number above."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left">
              <thead className="border-b border-neutral-200 text-[12px] text-[#6e6e73]">
                <tr>
                  <th className="py-2 pr-3 font-medium">Claim</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Main part</th>
                  <th className="px-3 py-2 font-medium">Work order</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 font-medium">Branch</th>
                  <th className="px-3 py-2 font-medium">Note</th>
                  <th className="py-2 pl-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {shown.map((r) => (
                  <Row key={r.claimNumber} r={r} cur={currency} canEdit={data.canEdit} onChanged={(p) => patchRow(r.claimNumber, p)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
