"use client";

import { useEffect, useState } from "react";
import { getFinanceMonthly, type FinanceMonth } from "@/app/actions/finance-monthly";
import { C, GroupedColumns, monthShort } from "@/components/dashboard/charts";
import { Label, Panel, fmtCompact, fmtInt, fmtMoney } from "@/components/dashboard/ui";
import { CarLoaderCard } from "@/components/spinner";

/**
 * Claims & Financials month chart - always at least 5 months: claimed vs adjusted (repair end date). The claims vs
 * invoicing comparison lives in Reconciliation (claims-vs-invoicing.tsx).
 */
export function FinanceMonths({ from, to, branchIds, cur }: { from: string; to: string; branchIds: string[]; cur: string }) {
  const [state, setState] = useState<{ key: string; months: FinanceMonth[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `${from}|${to}|${branchIds.join(",")}`;
  useEffect(() => {
    let live = true;
    getFinanceMonthly({ from, to, branchIds })
      .then((r) => live && setState({ key, months: r.months }))
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

    </div>
  );
}
