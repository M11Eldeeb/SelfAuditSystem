"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { loadReconciliation, saveReconciliation, type ReconciliationRow } from "@/app/admin/dashboard/reconciliation-actions";
import { C, StackedBar } from "@/components/dashboard/charts";
import { settlementDate } from "@/lib/dashboard/recon-constants";
import { Card, Label, Metric, Panel, Pill, fmtDate, fmtInt, fmtNum } from "@/components/dashboard/ui";

type Filter = "all" | "open" | "reinvoiced" | "overdue";

const selectClass =
  "rounded-lg border-0 bg-[#eff4ff] px-2.5 py-1.5 text-xs font-semibold text-[#0b1c30] ring-1 ring-[#dce9ff] focus:ring-2 focus:ring-[#c4121a]/30 focus:outline-none";

function Toggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T | null;
  options: { value: T; label: string; on: string }[];
  onChange: (v: T | null) => void;
}) {
  return (
    <div className="inline-flex rounded-lg bg-[#eff4ff] p-0.5">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            // Clicking the active choice again clears it.
            onClick={() => onChange(active ? null : o.value)}
            className={`rounded-md px-1.5 py-1 text-[11px] font-bold whitespace-nowrap transition ${active ? `${o.on} shadow-sm` : "text-[#575e70] hover:text-[#0b1c30]"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** "HER-12345-2" -> "12345": the job card number without branch prefix or repeat suffix. */
function workOrderNumber(workOrderNo: string): string {
  return workOrderNo.match(/^[A-Za-z]+-(\d+)/)?.[1] ?? (workOrderNo.replace(/\D/g, "") || workOrderNo);
}

/** Click to copy `copy` (which may differ from what's shown); flashes "Copied". */
function CopyText({ text, copy, className = "" }: { text: string; copy: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={`Copy ${copy}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(copy);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          // Clipboard blocked (e.g. insecure context) - nothing to do.
        }
      }}
      className={`group/copy flex max-w-full items-center gap-1 rounded px-1 -mx-1 text-left transition hover:bg-[#dce9ff] ${className}`}
    >
      <span className="truncate">{copied ? "Copied!" : text}</span>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0 opacity-0 transition group-hover/copy:opacity-60" aria-hidden="true">
        {copied ? <path d="M5 12l5 5L20 7" /> : <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>}
      </svg>
    </button>
  );
}

/** One truncated line; the full text pops up while the cursor is on it. */
function HoverText({ text, className = "" }: { text: string | null; className?: string }) {
  if (!text) return <div className={className}>—</div>;
  return (
    <div className={`group/hover relative ${className}`}>
      <div className="truncate">{text}</div>
      <div className="pointer-events-none absolute top-full left-0 z-30 mt-1 hidden max-w-80 rounded-lg bg-[#0b1c30] px-3 py-1.5 text-[11px] font-medium whitespace-normal text-white shadow-lg group-hover/hover:block">
        {text}
      </div>
    </div>
  );
}

function NotesEditor({ row, onSave, onClose }: { row: ReconciliationRow; onSave: (notes: string) => void; onClose: () => void }) {
  const [text, setText] = useState(row.notes ?? "");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div>
          <Label>Notes</Label>
          <div className="font-display text-base font-semibold text-[#0b1c30]">{row.claimNumber}</div>
          <div className="text-xs text-[#575e70]">
            {row.workOrderNo} · loss {fmtNum(row.lossAmount, 2)}
          </div>
        </div>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder="e.g. Reinvoiced on credit note …, waiting for SAIC reply …"
          className="w-full rounded-lg bg-[#eff4ff] p-3 text-sm ring-1 ring-[#dce9ff] focus:ring-2 focus:ring-[#c4121a]/30 focus:outline-none"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-[#575e70] hover:text-[#0b1c30]">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(text)}
            className="rounded-lg bg-[#c4121a] px-4 py-1.5 text-sm font-bold text-white transition hover:bg-[#9a000d]"
          >
            Save notes
          </button>
        </div>
      </div>
    </div>
  );
}

export function ReconciliationSection({
  settlementOrders,
  branches,
  currency,
}: {
  settlementOrders: string[];
  branches: { id: string; name: string }[];
  currency: string;
}) {
  const [order, setOrder] = useState(settlementOrders[0] ?? "");
  const [branchId, setBranchId] = useState("");
  const [rows, setRows] = useState<ReconciliationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [lossOnly, setLossOnly] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<ReconciliationRow | null>(null);
  const [saving, setSaving] = useState<Set<string>>(new Set());

  const branchName = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);

  useEffect(() => {
    if (!order) return;
    startLoading(async () => {
      setError(null);
      try {
        setRows(await loadReconciliation(order, branchId ? [branchId] : []));
      } catch (e) {
        setRows(null);
        setError(e instanceof Error ? e.message : "Could not load this settlement.");
      }
    });
  }, [order, branchId]);

  const update = async (row: ReconciliationRow, patch: Parameters<typeof saveReconciliation>[1]) => {
    // Optimistic: apply just the changed fields to the current row at once
    // (the server merges the same way), reload the settlement if it fails.
    const fields: Partial<ReconciliationRow> = {
      ...(patch.deductionType !== undefined && { deductionType: patch.deductionType }),
      ...(patch.outcome !== undefined && { outcome: patch.outcome }),
      ...(patch.notes !== undefined && { notes: patch.notes?.trim() || null }),
    };
    setRows((rs) => rs?.map((r) => (r.claimId === row.claimId ? { ...r, ...fields } : r)) ?? rs);
    setSaving((s) => new Set(s).add(row.claimId));
    const res = await saveReconciliation(row.claimId, patch);
    setSaving((s) => {
      const n = new Set(s);
      n.delete(row.claimId);
      return n;
    });
    if (res.error) {
      setError(`Couldn't save ${row.claimNumber}: ${res.error}`);
      setRows(await loadReconciliation(order, branchId ? [branchId] : []).catch(() => rows));
    }
  };

  const withLoss = (rows ?? []).filter((r) => r.lossAmount > 0.005);
  const base = lossOnly ? withLoss : (rows ?? []);
  const q = query.trim().toLowerCase();
  const visible = base
    .filter((r) =>
      filter === "all" ? true : filter === "open" ? !r.outcome : r.outcome === filter
    )
    .filter(
      (r) =>
        !q ||
        [r.vin, r.claimNumber, r.workOrderNo, r.laborName, r.partName].some((v) => v?.toLowerCase().includes(q))
    )
    .sort((a, b) => b.lossAmount - a.lossAmount);

  const totalLoss = withLoss.reduce((s, r) => s + r.lossAmount, 0);
  const sum = (f: (r: ReconciliationRow) => boolean) => withLoss.filter(f).reduce((s, r) => s + r.lossAmount, 0);
  const saic = sum((r) => r.deductionType === "saic");
  const internal = sum((r) => r.deductionType === "internal");
  const gw = sum((r) => r.deductionType === "gw");
  const reinvoiced = sum((r) => r.outcome === "reinvoiced");
  const overdue = sum((r) => r.outcome === "overdue");
  const reviewed = withLoss.filter((r) => r.deductionType || r.outcome).length;

  return (
    <div className="space-y-5">
      <Panel
        eyebrow="Settlement reconciliation"
        title="Settled claims by settlement order"
        subtitle="Review each claim SAIC paid less than claimed: who deducted it, and whether it was reinvoiced or is overdue."
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <Label>Settlement no.</Label>
            <select value={order} onChange={(e) => setOrder(e.target.value)} className={`block ${selectClass} min-w-48`}>
              {settlementOrders.map((o) => (
                <option key={o} value={o}>
                  {o} · {settlementDate(o)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <Label>Branch</Label>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={`block ${selectClass} min-w-44`}>
              <option value="">All branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 pb-1.5 text-xs font-semibold text-[#575e70]">
            <input type="checkbox" checked={lossOnly} onChange={(e) => setLossOnly(e.target.checked)} className="accent-[#c4121a]" />
            Only claims with a loss
          </label>
          {isLoading && <Pill tone="muted">Loading…</Pill>}
        </div>
        {error && <p className="mt-3 rounded-lg bg-[#ffdad6] px-3 py-2 text-sm text-[#93000a]">{error}</p>}
      </Panel>

      {rows && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card accent={C.red}>
            <Label>Total loss</Label>
            <Metric value={fmtNum(totalLoss, 2)} unit={currency} tone="red" />
            <div className="text-[11px] text-[#575e70]">
              {fmtInt(withLoss.length)} of {fmtInt(rows.length)} settled claims paid short
            </div>
          </Card>
          <Card accent={C.blue}>
            <Label>Reviewed</Label>
            <Metric value={`${reviewed}/${withLoss.length}`} unit="claims" />
            <StackedBar
              legend={false}
              height="h-2"
              segments={[
                { label: "Reviewed", value: reviewed, color: C.blue },
                { label: "Open", value: withLoss.length - reviewed, color: "#dce9ff" },
              ]}
            />
          </Card>
          <Card accent={C.slate}>
            <Label>Deducted by</Label>
            <div className="mt-1 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-[#575e70]">SAIC</span>
                <strong>{fmtNum(saic, 2)}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-[#575e70]">Internally</span>
                <strong>{fmtNum(internal, 2)}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-[#575e70]">GW</span>
                <strong>{fmtNum(gw, 2)}</strong>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[#575e70]">Not classified</span>
                <span>{fmtNum(totalLoss - saic - internal - gw, 2)}</span>
              </div>
            </div>
          </Card>
          <Card accent={C.green}>
            <Label>Recovery</Label>
            <div className="mt-1 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-emerald-700">Reinvoiced</span>
                <strong>{fmtNum(reinvoiced, 2)}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-[#9a000d]">Overdue</span>
                <strong>{fmtNum(overdue, 2)}</strong>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[#575e70]">No outcome yet</span>
                <span>{fmtNum(totalLoss - reinvoiced - overdue, 2)}</span>
              </div>
            </div>
          </Card>
        </div>
      )}

      {rows && (
        <Panel
          title={`${order}${branchId ? ` · ${branchName.get(branchId)}` : ""}`}
          subtitle={`${fmtInt(visible.length)} claims shown · largest loss first · choices save automatically`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg bg-[#eff4ff] p-0.5">
                {(
                  [
                    ["all", "All"],
                    ["open", "No outcome"],
                    ["reinvoiced", "Reinvoiced"],
                    ["overdue", "Overdue"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setFilter(k)}
                    className={`rounded-md px-2.5 py-1 text-xs font-bold transition ${filter === k ? "bg-white text-[#0b1c30] shadow-sm" : "text-[#575e70] hover:text-[#0b1c30]"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search VIN, claim, WO…" className={`${selectClass} w-48 font-medium`} />
            </div>
          }
        >
          {/* Fixed layout so a full row fits the panel without sideways scroll;
              long labor / part / notes text is cut and shown in full on hover. */}
          <div className="overflow-x-auto lg:overflow-visible">
            <table className="w-full min-w-[60rem] table-fixed text-left text-xs">
              <colgroup>
                <col className="w-[9.25rem]" />
                <col className="w-[9rem]" />
                <col className="w-[6.5rem]" />
                <col className="w-[6rem]" />
                <col className="w-[5.75rem]" />
                <col />
                <col className="w-[10rem]" />
                <col className="w-[9.5rem]" />
                <col className="w-[5.5rem]" />
              </colgroup>
              <thead className="bg-[#eff4ff] text-[10px] font-bold tracking-wider text-[#575e70] uppercase">
                <tr>
                  <th className="px-2 py-2.5">VIN</th>
                  <th className="px-2 py-2.5">Claim no.</th>
                  <th className="px-2 py-2.5">Work order</th>
                  <th className="px-2 py-2.5 text-right">Loss</th>
                  <th className="px-2 py-2.5">1st submit</th>
                  <th className="px-2 py-2.5">Labor / part</th>
                  <th className="px-2 py-2.5">Deducted by</th>
                  <th className="px-2 py-2.5">Outcome</th>
                  <th className="px-2 py-2.5">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5eeff]">
                {visible.map((r) => (
                  <tr key={r.claimId} className={`align-middle ${saving.has(r.claimId) ? "opacity-60" : ""} hover:bg-[#eff4ff]/50`}>
                    <td className="truncate px-2 py-2 font-mono text-[11px]">{r.vin ?? "—"}</td>
                    <td className="px-2 py-2">
                      <CopyText text={r.claimNumber} copy={r.claimNumber} className="font-semibold" />
                      {!branchId && <div className="truncate text-[10px] text-[#575e70]">{branchName.get(r.branchId)}</div>}
                    </td>
                    <td className="px-2 py-2">
                      {r.workOrderNo ? <CopyText text={r.workOrderNo} copy={workOrderNumber(r.workOrderNo)} /> : "—"}
                    </td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      <span className={`font-display text-[13px] font-bold ${r.lossAmount > 0.005 ? "text-[#9a000d]" : "text-[#575e70]"}`}>
                        {fmtNum(r.lossAmount, 2)}
                      </span>
                      <div className="text-[10px] text-[#575e70]">of {fmtNum(r.claimAmount, 2)}</div>
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">{fmtDate(r.firstSubmitDate)}</td>
                    <td className="px-2 py-2">
                      <HoverText text={r.laborName} className="font-semibold text-[#0b1c30]" />
                      <HoverText text={r.partName} className="text-[10px] text-[#575e70]" />
                    </td>
                    <td className="px-2 py-2">
                      <Toggle
                        value={r.deductionType}
                        onChange={(v) => update(r, { deductionType: v })}
                        options={[
                          { value: "saic", label: "SAIC", on: "bg-[#0041b0] text-white" },
                          { value: "internal", label: "Internal", on: "bg-[#575e70] text-white" },
                          { value: "gw", label: "GW", on: "bg-[#7c3aed] text-white" },
                        ]}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Toggle
                        value={r.outcome}
                        onChange={(v) => update(r, { outcome: v })}
                        options={[
                          { value: "reinvoiced", label: "Reinvoiced", on: "bg-emerald-600 text-white" },
                          { value: "overdue", label: "Overdue", on: "bg-[#c4121a] text-white" },
                        ]}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <div className="group relative">
                        <button
                          type="button"
                          onClick={() => setEditing(r)}
                          className={`block w-full truncate rounded-lg px-2 py-1 text-left text-[11px] font-semibold ring-1 transition ${
                            r.notes ? "bg-[#fff7e6] text-amber-800 ring-amber-200" : "bg-white text-[#575e70] ring-[#dce9ff] hover:bg-[#eff4ff]"
                          }`}
                        >
                          {r.notes ? `📝 ${r.notes}` : "+ Notes"}
                        </button>
                        {r.notes && (
                          <div className="pointer-events-none absolute top-full right-0 z-30 mt-1 hidden w-64 rounded-lg bg-[#0b1c30] px-3 py-2 text-[11px] whitespace-pre-wrap text-white shadow-lg group-hover:block">
                            {r.notes}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-10 text-center text-sm text-[#575e70]">
                      No claims match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {editing && (
        <NotesEditor
          row={editing}
          onClose={() => setEditing(null)}
          onSave={(notes) => {
            update(editing, { notes });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
