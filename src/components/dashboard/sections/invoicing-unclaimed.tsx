"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { clearUnclaimedMark, getUnclaimedWarranty, markUnclaimed, type UnclaimedLine } from "@/app/admin/dashboard/invoicing-actions";
import { Panel, Pill } from "@/components/dashboard/ui";
import { Sar } from "@/components/dashboard/riyal";
import { downloadXlsx, LINE_COLUMNS, type ExportColumn } from "./invoicing-export";
import { INV } from "./invoicing-charts";
import { Glyph } from "@/components/ui/glyph";

type View = "open" | "done" | "all";
const STATUS_LABEL = { resolved: "Resolved", credit_note: "Credit note" } as const;
const stamp = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Riyadh" });

/**
 * Warranty lines invoiced without a claim number: every one must be explained - claimed later (resolved) or reversed
 * with a credit note. The officer ticks lines (or a whole WIP) and marks them; marks are kept across re-imports.
 */
export function UnclaimedWarranty({ month, branch }: { month: string; branch: string }) {
  const [rows, setRows] = useState<UnclaimedLine[] | null>(null);
  const [view, setView] = useState<View>("open");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    getUnclaimedWarranty(month).then(setRows, () => setMsg({ ok: false, text: "Could not load the lines." }));
  }, [month]);
  useEffect(() => {
    queueMicrotask(load);
  }, [load]);

  const scoped = useMemo(() => (rows ?? []).filter((r) => !branch || r.branch === branch), [rows, branch]);
  const open = scoped.filter((r) => !r.mark);
  const shown = scoped.filter((r) => (view === "all" ? true : view === "open" ? !r.mark : !!r.mark));
  const sum = (list: UnclaimedLine[]) => list.reduce((s, r) => s + r.amount, 0);
  const allPicked = shown.length > 0 && shown.every((r) => picked.has(r.key));

  const toggle = (key: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const toggleWip = (r: UnclaimedLine) => {
    const keys = shown.filter((x) => x.branch === r.branch && x.wip === r.wip).map((x) => x.key);
    setPicked((p) => {
      const n = new Set(p);
      const all = keys.every((k) => n.has(k));
      keys.forEach((k) => (all ? n.delete(k) : n.add(k)));
      return n;
    });
  };

  async function apply(status: "resolved" | "credit_note" | "clear") {
    const keys = [...picked];
    if (!keys.length) return;
    setBusy(true);
    setMsg(null);
    const res = status === "clear" ? await clearUnclaimedMark(keys) : await markUnclaimed(month, keys, status, note);
    setBusy(false);
    if (res.error) setMsg({ ok: false, text: res.error });
    else {
      setMsg({ ok: true, text: status === "clear" ? `${keys.length} line(s) opened again.` : `${keys.length} line(s) marked as ${STATUS_LABEL[status]}.` });
      setPicked(new Set());
      setNote("");
      load();
    }
  }

  const exportCols: ExportColumn<UnclaimedLine>[] = [
    ...(LINE_COLUMNS as unknown as ExportColumn<UnclaimedLine>[]),
    { header: "Status", value: (r) => (r.mark ? STATUS_LABEL[r.mark.status] : "Open") },
    { header: "Note", value: (r) => r.mark?.note ?? "", width: 30 },
    { header: "Marked by", value: (r) => r.mark?.by ?? "" },
    { header: "Marked at", value: (r) => (r.mark ? stamp(r.mark.at) : "") },
  ];

  return (
    <Panel
      eyebrow="Needs action"
      title="Warranty invoiced without a claim number"
      subtitle="Warranty labor and parts invoiced with no claim order number - mark each one resolved (claimed) or credit note (reversed)"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={open.length ? "bad" : "good"}>
            {open.length} open · <Sar value={sum(open)} />
          </Pill>
          <button
            type="button"
            disabled={!shown.length}
            onClick={() => void downloadXlsx(`Warranty without claim ${month.slice(0, 7)}.xlsx`, "No claim number", exportCols, shown)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-40"
          >
            <Glyph name="download" className="mr-1" />Export
          </button>
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(["open", "done", "all"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${view === v ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}
          >
            {v === "open" ? `Open (${open.length})` : v === "done" ? `Marked (${scoped.length - open.length})` : `All (${scoped.length})`}
          </button>
        ))}
      </div>

      {picked.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: INV.soft }}>
          <span className="text-sm font-semibold text-slate-900">{picked.size} selected</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional) - e.g. claim no. or credit note no." className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm" />
          <button type="button" disabled={busy} onClick={() => void apply("resolved")} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
            <Glyph name="check" className="mr-0.5" />Resolved
          </button>
          <button type="button" disabled={busy} onClick={() => void apply("credit_note")} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ backgroundColor: INV.parts }}>
            Credit note
          </button>
          {view !== "open" && (
            <button type="button" disabled={busy} onClick={() => void apply("clear")} className="text-xs font-medium text-slate-600 underline">
              Open again
            </button>
          )}
        </div>
      )}
      {msg && <p className={`mb-3 rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}

      {!rows ? (
        <div className="h-24 animate-pulse rounded-lg bg-slate-50" />
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">{view === "open" ? "Nothing open - every warranty line has a claim number or is marked." : "No lines."}</p>
      ) : (
        <div className="max-h-[28rem] overflow-auto rounded-lg ring-1 ring-slate-200">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 text-left text-[11px] font-bold tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-2 py-2">
                  <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(shown.map((r) => r.key)))} aria-label="Select all" />
                </th>
                {["Date", "Type", "Branch", "WIP", "Invoice", "Owing operator", "Code", "Description", "Amount (SAR)", "Status"].map((h) => (
                  <th key={h} className={`px-2 py-2 whitespace-nowrap ${h.startsWith("Amount") ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((r) => (
                <tr key={r.key} className={`hover:bg-slate-50 ${picked.has(r.key) ? "bg-red-50/60" : ""}`}>
                  <td className="px-2 py-1.5">
                    <input type="checkbox" checked={picked.has(r.key)} onChange={() => toggle(r.key)} aria-label="Select line" />
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{r.date}</td>
                  <td className="px-2 py-1.5">{r.source === "labor" ? "Labor" : "Parts"}</td>
                  <td className="px-2 py-1.5">{r.branch}</td>
                  <td className="px-2 py-1.5">
                    <button type="button" onClick={() => toggleWip(r)} title="Select every line of this WIP" className="font-mono underline decoration-dotted">
                      {r.wip}
                    </button>
                  </td>
                  <td className="px-2 py-1.5 font-mono select-all">{r.invoice}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{r.operator}</td>
                  <td className="px-2 py-1.5 font-mono">{r.item}</td>
                  <td className="max-w-[18rem] truncate px-2 py-1.5" title={r.description}>
                    {r.description}
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{r.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {r.mark ? (
                      <span title={`${r.mark.by ?? ""} · ${stamp(r.mark.at)}${r.mark.note ? ` · ${r.mark.note}` : ""}`}>
                        <span className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white" style={{ backgroundColor: r.mark.status === "resolved" ? "#059669" : INV.parts }}>
                          {STATUS_LABEL[r.mark.status]}
                        </span>
                        {r.mark.note && <span className="ml-1 text-slate-500">{r.mark.note}</span>}
                      </span>
                    ) : (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700">Open</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
