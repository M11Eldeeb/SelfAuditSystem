"use client";

import { useEffect, useState } from "react";
import { getFinanceMonthly, type FinanceMonth } from "@/app/actions/finance-monthly";
import { C, GroupedColumns, monthShort } from "@/components/dashboard/charts";
import { TipCard, useHoverCard } from "@/components/dashboard/hover";
import { Label, Panel, fmtCompact, fmtInt, fmtMoney } from "@/components/dashboard/ui";
import { CarLoaderCard } from "@/components/spinner";

const PART = { labor: "#3a3a3c", parts: "#8e8e93", sublet: "#c7c7cc" };

/** Per month two stacked columns: submitted claims (labor / parts / sublet) and warranty invoiced (labor / parts). */
export function SubmittedVsInvoiced({ months, cur }: { months: FinanceMonth[]; cur: string }) {
  const { bind, layer } = useHoverCard();
  const max = Math.max(...months.flatMap((m) => [m.submitted.total || m.submitted.labor + m.submitted.parts + m.submitted.sublet, m.invoiced?.total ?? 0]), 1);
  const col = (parts: { key: keyof typeof PART; value: number }[], tip: React.ReactNode, label: string, faded = false) => {
    const total = parts.reduce((s, p) => s + p.value, 0);
    return (
      <div className="flex h-full w-full flex-col items-center justify-end gap-1" {...bind(tip)}>
        <span className="text-[11px] font-semibold tabular-nums text-[#3a3a3c]">{total ? fmtCompact(total) : ""}</span>
        <div className={`flex w-full max-w-9 flex-col-reverse overflow-hidden rounded-md ${faded ? "opacity-60" : ""}`} style={{ height: `${Math.max((total / max) * 100, total ? 2 : 0)}%` }}>
          {parts.map((p) => (
            <div key={p.key} style={{ height: `${total ? (p.value / total) * 100 : 0}%`, backgroundColor: PART[p.key] }} />
          ))}
        </div>
        <span className="text-[11px] text-[#6e6e73]">{label}</span>
      </div>
    );
  };
  return (
    <div className="space-y-3">
      {layer}
      <div className="flex flex-wrap gap-4 text-xs text-[#6e6e73]">
        {(["labor", "parts", "sublet"] as const).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: PART[k] }} />
            {k === "labor" ? "Labor" : k === "parts" ? "Parts" : "Sublet"}
          </span>
        ))}
        <span>C = submitted claims · I = warranty invoiced</span>
      </div>
      <div className="grid h-64 gap-3" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}>
        {months.map((m) => {
          const s = m.submitted;
          const gap = m.invoiced ? m.invoiced.total - s.total : null;
          return (
            <div key={m.month} className="flex min-w-0 flex-col">
              <div className="grid flex-1 grid-cols-2 items-end gap-1">
                {col(
                  [
                    { key: "labor", value: s.labor },
                    { key: "parts", value: s.parts },
                    { key: "sublet", value: s.sublet },
                  ],
                  <TipCard
                    title={`${monthShort(m.month)} - submitted claims`}
                    rows={[
                      { label: "Labor", value: fmtMoney(s.labor) },
                      { label: "Parts", value: fmtMoney(s.parts) },
                      { label: "Sublet", value: fmtMoney(s.sublet) },
                      { label: `Total (${cur})`, value: fmtMoney(s.total), strong: true },
                      { label: "Claims", value: fmtInt(m.submittedClaims) },
                    ]}
                    note="By first submit date"
                  />,
                  "C"
                )}
                {m.invoiced ? (
                  col(
                    [
                      { key: "labor", value: m.invoiced.labor },
                      { key: "parts", value: m.invoiced.parts },
                    ],
                    <TipCard
                      title={`${monthShort(m.month)} - warranty invoiced`}
                      rows={[
                        { label: "Labor", value: fmtMoney(m.invoiced.labor) },
                        { label: "Parts", value: fmtMoney(m.invoiced.parts) },
                        { label: `Total (${cur})`, value: fmtMoney(m.invoiced.total), strong: true },
                        { label: "Invoiced - submitted", value: fmtMoney(gap ?? 0) },
                      ]}
                      note="Sales type Warranty, invoice month, SAR ÷ 3.75"
                    />,
                    "I"
                  )
                ) : (
                  <div className="flex h-full items-end justify-center pb-5 text-center text-[10px] leading-tight text-[#8e8e93]" title="No invoicing report imported for this month">
                    no report
                  </div>
                )}
              </div>
              <div className="mt-1 text-center text-[12px] font-medium text-[#1d1d1f]">{monthShort(m.month)}</div>
              {gap != null && (
                <div className={`text-center text-[11px] tabular-nums ${gap < 0 ? "text-[#b10012]" : "text-[#6e6e73]"}`}>
                  {gap >= 0 ? "+" : "−"}
                  {fmtCompact(Math.abs(gap))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Claims & Financials month charts - always at least 5 months: claimed vs adjusted (repair end date), then submitted
 * claims vs warranty invoiced with the labor / parts / sublet split.
 */
export function FinanceMonths({ from, to, branchIds, cur }: { from: string; to: string; branchIds: string[]; cur: string }) {
  const [state, setState] = useState<{ key: string; months: FinanceMonth[]; partial: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `${from}|${to}|${branchIds.join(",")}`;
  useEffect(() => {
    let live = true;
    getFinanceMonthly({ from, to, branchIds })
      .then((r) => live && setState({ key, months: r.months, partial: r.partialInvoicing }))
      .catch(() => live && setError("Could not load the month charts."));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (error) return <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (!state || state.key !== key) return <CarLoaderCard height="h-96" label="Loading the month charts…" />;
  const months = state.months;
  const totals = months.reduce((s, m) => ({ claimed: s.claimed + m.claimed, adjusted: s.adjusted + m.adjusted }), { claimed: 0, adjusted: 0 });
  const withInvoice = months.filter((m) => m.invoiced);
  const sub = withInvoice.reduce((s, m) => s + m.submitted.total, 0);
  const inv = withInvoice.reduce((s, m) => s + (m.invoiced?.total ?? 0), 0);

  return (
    <div className="space-y-4">
      <Panel eyebrow="Settlement trajectory" title="Claimed vs adjusted" subtitle={`Per month by repair end date · ${monthShort(months[0].month)} – ${monthShort(months[months.length - 1].month)}`}>
        <GroupedColumns
          seriesNames={[`Claim TOL. (${cur})`, `Adjusted (${cur})`]}
          colors={[C.blueLight, C.green]}
          format={fmtCompact}
          groups={months.map((m) => ({ label: monthShort(m.month), sub: `${fmtInt(m.claims)} claims`, values: [m.claimed, m.adjusted] }))}
          line={{ name: "Detected", color: C.bad, values: months.map((m) => m.adjusted - m.claimed), format: (v) => fmtCompact(v) }}
        />
        <div className="mt-4 grid grid-cols-3 gap-3 rounded-lg bg-[#f5f5f7] p-3">
          <div>
            <Label>Claimed</Label>
            <div className="font-display text-lg font-semibold">{fmtMoney(totals.claimed)}</div>
          </div>
          <div>
            <Label>Adjusted</Label>
            <div className="font-display text-lg font-semibold">{fmtMoney(totals.adjusted)}</div>
          </div>
          <div>
            <Label>Detected</Label>
            <div className="font-display text-lg font-semibold text-[#d70015]">{fmtMoney(totals.adjusted - totals.claimed)}</div>
          </div>
        </div>
      </Panel>

      <Panel
        eyebrow="Claims vs invoicing"
        title="Submitted claims vs warranty invoiced"
        subtitle={`Per month · claims by first submit date, invoicing by invoice month (SAR converted at 3.75) · ${cur}`}
      >
        <SubmittedVsInvoiced months={months} cur={cur} />
        <div className="mt-4 grid grid-cols-3 gap-3 rounded-lg bg-[#f5f5f7] p-3">
          <div>
            <Label>Submitted{withInvoice.length < months.length ? " (months with a report)" : ""}</Label>
            <div className="font-display text-lg font-semibold">{fmtMoney(sub)}</div>
          </div>
          <div>
            <Label>Warranty invoiced</Label>
            <div className="font-display text-lg font-semibold">{fmtMoney(inv)}</div>
          </div>
          <div>
            <Label>Invoiced − submitted</Label>
            <div className={`font-display text-lg font-semibold ${inv - sub < 0 ? "text-[#d70015]" : ""}`}>{fmtMoney(inv - sub)}</div>
          </div>
        </div>
        {state.partial && <p className="mt-2 text-[12px] text-[#6e6e73]">Months marked &quot;no report&quot; have no invoicing report imported yet (Warranty invoicing starts with September 2026).</p>}
      </Panel>
    </div>
  );
}
