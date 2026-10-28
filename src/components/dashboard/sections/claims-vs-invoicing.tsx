"use client";

import { useEffect, useState } from "react";
import { getFinanceMonthly, type FinanceMonth } from "@/app/actions/finance-monthly";
import { monthShort } from "@/components/dashboard/charts";
import { Panel, fmtCompact, fmtInt, fmtMoney } from "@/components/dashboard/ui";
import { CarLoaderCard } from "@/components/spinner";

/** Warranty invoicing starts with this month (the first imported report). */
const FIRST_MONTH = "2026-09";
/** A gap within this share of the larger side is normal noise (rounding, timing); beyond it, it is flagged. */
const TOLERANCE = 0.02;

type Part = "labor" | "parts" | "sublet" | "total";
const PARTS: { key: Part; label: string }[] = [
  { key: "labor", label: "Labor" },
  { key: "parts", label: "Parts" },
  { key: "sublet", label: "Sublet" },
  { key: "total", label: "Total" },
];
const thisMonth = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 7);

type Cell = { claimed: number; invoiced: number | null; gap: number | null; pct: number | null; flagged: boolean };

function cell(claimed: number, invoiced: number | null): Cell {
  if (invoiced == null) return { claimed, invoiced: null, gap: null, pct: null, flagged: false };
  const gap = invoiced - claimed;
  const base = Math.max(Math.abs(claimed), Math.abs(invoiced), 1);
  return { claimed, invoiced, gap, pct: gap / base, flagged: Math.abs(gap) / base > TOLERANCE && Math.abs(gap) >= 50 };
}

/** The gap as a bar from the middle: right = invoiced but not claimed, left = claimed but not invoiced. */
function GapBar({ c, max }: { c: Cell; max: number }) {
  if (c.gap == null) return <div className="h-1.5" />;
  const w = Math.min(Math.abs(c.gap) / max, 1) * 50;
  const color = c.flagged ? "#d70015" : "#aeaeb2";
  return (
    <div className="relative h-1.5 rounded-full bg-neutral-900/[0.05]">
      <span className="absolute inset-y-0 left-1/2 w-px bg-neutral-900/20" />
      <span className="absolute inset-y-0 rounded-full" style={{ backgroundColor: color, width: `${w}%`, left: c.gap >= 0 ? "50%" : `${50 - w}%` }} />
    </div>
  );
}

function GapText({ c, cur }: { c: Cell; cur: string }) {
  if (c.gap == null) return <span className="text-[#8e8e93]">no invoicing data</span>;
  if (Math.abs(c.gap) < 0.5) return <span className="text-[#248a3d]">matches</span>;
  return (
    <span className={c.flagged ? "font-semibold text-[#b10012]" : "text-[#3a3a3c]"}>
      {c.gap > 0 ? "Not claimed " : "Not invoiced "}
      {fmtMoney(Math.abs(c.gap))} {cur}
      <span className="ms-1 font-normal text-[#8e8e93]">({Math.abs((c.pct ?? 0) * 100).toFixed(1)}%)</span>
    </span>
  );
}

/**
 * Reconciliation -> Claims vs invoicing: per month from September 2026, what was claimed (labor / parts / sublet) against
 * what was invoiced to warranty in the branches' system - the gap shows work invoiced but not claimed (money left with
 * the manufacturer) or claimed but not invoiced (an audit risk). Claims are matched by repair end date (closest to the
 * invoice date) or by first submit date.
 */
export function ClaimsVsInvoicing({ branches, currency }: { branches: { id: string; name: string }[]; currency: string }) {
  const [branch, setBranch] = useState("");
  const [basis, setBasis] = useState<"repaired" | "submitted">("repaired");
  const [state, setState] = useState<{ key: string; months: FinanceMonth[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = branch || "all";

  useEffect(() => {
    let live = true;
    getFinanceMonthly({ from: FIRST_MONTH, to: thisMonth(), branchIds: branch ? [branch] : [], exactRange: true })
      .then((r) => live && setState({ key, months: r.months }))
      .catch(() => live && setError("Could not load claims vs invoicing."));
    return () => {
      live = false;
    };
  }, [branch, key]);

  const cur = currency;
  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <select value={branch} onChange={(e) => setBranch(e.target.value)} className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-[13px]">
        <option value="">All branches</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <div className="inline-flex rounded-lg bg-neutral-900/[0.05] p-0.5 text-[12px] font-medium" role="group" aria-label="Match claims by">
        {(
          [
            ["repaired", "By repair end"],
            ["submitted", "By first submit"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={basis === k} onClick={() => setBasis(k)} className={`rounded-md px-2.5 py-1 ${basis === k ? "bg-[var(--surface)] text-neutral-900 shadow-sm" : "text-neutral-600"}`}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );

  if (error) return <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (!state || state.key !== key) return <CarLoaderCard height="h-96" label="Comparing claims with invoicing…" />;

  const months = state.months;
  const side = (m: FinanceMonth) => (basis === "repaired" ? m.repaired : m.submitted);
  const cellsOf = (m: FinanceMonth): Record<Part, Cell> => {
    const s = side(m);
    const inv = m.invoiced;
    return {
      labor: cell(s.labor, inv ? inv.labor : null),
      parts: cell(s.parts, inv ? inv.parts : null),
      // The invoicing report has no sublet column: sublet shows the claimed side only.
      sublet: cell(s.sublet, null),
      total: cell(s.labor + s.parts, inv ? inv.total : null),
    };
  };
  const rows = months.map((m) => ({ m, cells: cellsOf(m) }));
  const sum = (k: Part) => {
    const withInv = rows.filter((r) => r.cells[k].invoiced != null);
    return cell(
      (k === "sublet" ? rows : withInv).reduce((s, r) => s + r.cells[k].claimed, 0),
      k === "sublet" || !withInv.length ? null : withInv.reduce((s, r) => s + (r.cells[k].invoiced ?? 0), 0)
    );
  };
  const totals = Object.fromEntries(PARTS.map((p) => [p.key, sum(p.key)])) as Record<Part, Cell>;
  const maxGap = Math.max(...rows.flatMap((r) => PARTS.map((p) => Math.abs(r.cells[p.key].gap ?? 0))), 1);
  const flaggedCount = rows.reduce((s, r) => s + PARTS.filter((p) => p.key !== "total" && r.cells[p.key].flagged).length, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <p className="text-[13px] font-semibold text-[#6e6e73]">Claims vs invoicing</p>
          <h2 className="text-xl font-bold tracking-tight text-[#1d1d1f]">Discrepancies - claimed vs warranty invoiced</h2>
          <p className="mt-0.5 text-[14px] text-[#6e6e73]">
            From {monthShort(FIRST_MONTH)} · claims {basis === "repaired" ? "by repair end date" : "by first submit date"} vs invoicing by invoice month (sales type Warranty, SAR ÷ 3.75) · {cur}
          </p>
        </div>
        {header}
      </div>

      {/* Summary: one card per part. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {PARTS.map((p) => {
          const c = totals[p.key];
          return (
            <div key={p.key} className={`rounded-2xl bg-white p-4 ring-1 ${c.flagged ? "ring-[#d70015]/30" : "ring-black/[0.05]"}`}>
              <div className="flex items-baseline justify-between">
                <span className="text-[15px] font-semibold text-[#1d1d1f]">{p.label}</span>
                {p.key === "total" && <span className="text-[11px] text-[#8e8e93]">labor + parts</span>}
              </div>
              <div className="mt-2 space-y-0.5 text-[13px] tabular-nums">
                <div className="flex justify-between">
                  <span className="text-[#6e6e73]">Claimed</span>
                  <span className="font-medium">{fmtMoney(c.claimed)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#6e6e73]">Invoiced</span>
                  <span className="font-medium">{c.invoiced == null ? "—" : fmtMoney(c.invoiced)}</span>
                </div>
              </div>
              <div className="mt-2 space-y-1 text-[13px]">
                <GapBar c={c} max={Math.max(Math.abs(c.gap ?? 0), 1)} />
                <GapText c={c} cur={cur} />
              </div>
            </div>
          );
        })}
      </div>

      <Panel
        title="Per month"
        subtitle={
          flaggedCount
            ? `${flaggedCount} gap${flaggedCount === 1 ? "" : "s"} above ${TOLERANCE * 100}% - in red. Right of the line: invoiced but not claimed · left: claimed but not invoiced.`
            : `No gap above ${TOLERANCE * 100}%. Right of the line: invoiced but not claimed · left: claimed but not invoiced.`
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead className="border-b border-neutral-200 text-left text-[12px] text-[#6e6e73]">
              <tr>
                <th className="py-2 pr-3 font-medium">Month</th>
                {PARTS.map((p) => (
                  <th key={p.key} className="px-3 py-2 font-medium">
                    {p.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 tabular-nums">
              {rows.map(({ m, cells }) => (
                <tr key={m.month} className="align-top">
                  <td className="py-3 pr-3">
                    <div className="font-semibold text-[#1d1d1f]">{monthShort(m.month)}</div>
                    <div className="text-[12px] text-[#8e8e93]">{fmtInt(basis === "repaired" ? m.claims : m.submittedClaims)} claims</div>
                  </td>
                  {PARTS.map((p) => {
                    const c = cells[p.key];
                    return (
                      <td key={p.key} className={`px-3 py-3 ${c.flagged ? "bg-[#d70015]/[0.04]" : ""}`}>
                        <div className="text-[12px] text-[#6e6e73]">
                          C {fmtCompact(c.claimed)} · I {c.invoiced == null ? "—" : fmtCompact(c.invoiced)}
                        </div>
                        <div className="my-1.5">
                          <GapBar c={c} max={maxGap} />
                        </div>
                        <div className="text-[12px]">
                          <GapText c={c} cur={cur} />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[12px] text-[#6e6e73]">
          Sublet is not in the invoicing report, so only its claimed amount is shown. A month with no invoicing data has no report imported yet. Gaps can also come from timing (work invoiced one month,
          claimed the next) - compare both &quot;By repair end&quot; and &quot;By first submit&quot;.
        </p>
      </Panel>
    </div>
  );
}
