"use client";

import type { ReactNode } from "react";
import { TipCard, useHoverCard } from "@/components/dashboard/hover";
import { CountText } from "@/components/dashboard/motion";
import { monthShort } from "@/components/dashboard/charts";
import { fmtInt } from "@/components/dashboard/ui";

export type PeriodKey = "3m" | "6m" | "12m" | "ytd" | "all";
export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "3m", label: "3 months" },
  { key: "6m", label: "6 months" },
  { key: "12m", label: "12 months" },
  { key: "ytd", label: "This year" },
  { key: "all", label: "All" },
];

export const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
export const monthsBetween = (from: string, to: string) => {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
};

/** The months of a period ending with the current month, and the same number of months before it (for the change). */
export function periodRange(key: PeriodKey, today: string, firstMonth: string | null): { from: string; to: string; prevFrom: string | null; prevTo: string | null } {
  const to = today.slice(0, 7);
  const n = key === "3m" ? 3 : key === "6m" ? 6 : key === "12m" ? 12 : null;
  if (n) return { from: addMonths(to, -(n - 1)), to, prevFrom: addMonths(to, -(2 * n - 1)), prevTo: addMonths(to, -n) };
  if (key === "ytd") {
    const from = `${to.slice(0, 4)}-01`;
    const len = monthsBetween(from, to).length;
    return { from, to, prevFrom: addMonths(from, -12), prevTo: addMonths(from, -12 + len - 1) };
  }
  return { from: firstMonth ?? to, to, prevFrom: null, prevTo: null };
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="inline-flex flex-wrap rounded-lg bg-neutral-900/[0.05] p-0.5 text-[12px] font-medium" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={value === o.key} onClick={() => onChange(o.key)} className={`rounded-md px-2.5 py-1 ${value === o.key ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: ReactNode; tone?: "bad" | "good" }) {
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-black/[0.05]">
      <div className="text-[13px] font-medium text-[#6e6e73]">{label}</div>
      <CountText value={value} className={`mt-1 block text-[26px] leading-tight font-semibold tracking-tight tabular-nums ${tone === "bad" ? "text-[#d70015]" : tone === "good" ? "text-[#248a3d]" : "text-[#1d1d1f]"}`} />
      {sub && <div className="mt-0.5 text-[12px] text-[#6e6e73]">{sub}</div>}
    </div>
  );
}

/** "+12% vs previous" - more complaints is bad (red), fewer is good (green). */
export function Change({ now, before }: { now: number; before: number | null }) {
  if (before == null) return null;
  if (!before) return <span className="text-[#8e8e93]">none in the previous period</span>;
  const pct = ((now - before) / before) * 100;
  if (Math.abs(pct) < 0.5) return <span className="text-[#6e6e73]">same as the previous period</span>;
  return (
    <span className={pct > 0 ? "text-[#d70015]" : "text-[#248a3d]"}>
      {pct > 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}% vs previous period ({fmtInt(before)})
    </span>
  );
}

/** Columns per month, stacked by series; the number on top is the month's total. */
export function MonthColumns({ months, series, values, note }: { months: string[]; series: { key: string; label: string; color: string }[]; values: (month: string, key: string) => number; note?: (month: string) => string }) {
  const { bind, layer } = useHoverCard();
  const totals = months.map((m) => series.reduce((s, x) => s + values(m, x.key), 0));
  const max = Math.max(...totals, 1);
  return (
    <div className="space-y-3">
      {layer}
      <div className="flex flex-wrap gap-4 text-xs text-[#6e6e73]">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto">
        <div className="grid h-56 gap-1.5" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(28px, 1fr))`, minWidth: months.length * 30 }}>
          {months.map((m, i) => (
            <div
              key={m}
              className="flex h-full min-w-0 flex-col items-center justify-end gap-1"
              {...bind(
                <TipCard
                  title={monthShort(m)}
                  rows={[...series.map((s) => ({ label: s.label, value: fmtInt(values(m, s.key)), color: s.color })), { label: "Total", value: fmtInt(totals[i]), strong: true }]}
                  note={note?.(m)}
                />
              )}
            >
              <span className="text-[11px] font-semibold tabular-nums text-[#3a3a3c]">{totals[i] || ""}</span>
              <div className="flex w-full max-w-8 flex-col-reverse overflow-hidden rounded-md" style={{ height: `${Math.max((totals[i] / max) * 100, totals[i] ? 2 : 0)}%` }}>
                {series.map((s) => (
                  <div key={s.key} style={{ height: `${totals[i] ? (values(m, s.key) / totals[i]) * 100 : 0}%`, backgroundColor: s.color }} />
                ))}
              </div>
              <span className="text-[10px] whitespace-nowrap text-[#6e6e73]">{monthShort(m)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A heat-map table: rows x columns, the cell shade grows with the count. */
export function Heatmap({ rows, cols, value, colLabel = (c) => c, onRowTotal = true }: { rows: string[]; cols: string[]; value: (r: string, c: string) => number; colLabel?: (c: string) => string; onRowTotal?: boolean }) {
  const max = Math.max(...rows.flatMap((r) => cols.map((c) => value(r, c))), 1);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px] tabular-nums">
        <thead>
          <tr className="text-[#6e6e73]">
            <th className="sticky left-0 bg-white py-1.5 pr-3 text-left font-medium" />
            {cols.map((c) => (
              <th key={c} className="px-1 py-1.5 text-center font-medium whitespace-nowrap">
                {colLabel(c)}
              </th>
            ))}
            {onRowTotal && <th className="px-2 py-1.5 text-right font-medium">Total</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r}>
              <td className="sticky left-0 bg-white py-0.5 pr-3 font-medium whitespace-nowrap text-[#1d1d1f]">{r}</td>
              {cols.map((c) => {
                const v = value(r, c);
                const a = v ? 0.08 + (v / max) * 0.82 : 0;
                return (
                  <td key={c} className="p-0.5">
                    <div className="rounded-md py-1.5 text-center" style={{ backgroundColor: v ? `rgba(196,18,26,${a})` : "rgba(0,0,0,0.03)", color: a > 0.5 ? "#fff" : "#1d1d1f" }} title={`${r} · ${colLabel(c)}: ${v}`}>
                      {v || ""}
                    </div>
                  </td>
                );
              })}
              {onRowTotal && <td className="px-2 text-right font-semibold">{fmtInt(cols.reduce((s, c) => s + value(r, c), 0))}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function count<T>(list: T[], key: (x: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of list) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return m;
}
