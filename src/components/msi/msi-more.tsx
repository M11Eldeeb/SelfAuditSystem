"use client";

import { useMemo, useState } from "react";
import { Panel } from "@/components/dashboard/ui";
import { C, GroupedColumns } from "@/components/dashboard/charts";
import { Chips, Empty, MONTHS, Pct, TableWrap, dec, money, pct, td, tdr, th, thr } from "@/components/msi/msi-ui";
import type { DailyRow, KpiRow, MonthlyRow, MsiExtra, MsiReport } from "@/lib/msi/types";

type Scoped = { scope: string; scopeName: string };
/** The branches of a sheet in the report's order (KSA first); the ones with no figures at all are left out. */
function scopesOf<T extends Scoped>(rows: T[], hasData: (r: T) => boolean): { id: string; label: string }[] {
  const out = new Map<string, string>();
  for (const r of rows) if (hasData(r) && !out.has(r.scope)) out.set(r.scope, r.scope === "KSA" ? "KSA" : r.scopeName);
  return [...out].map(([id, label]) => ({ id, label }));
}
const headline = <T extends Scoped & { type: string; channel: string }>(rows: T[]) => rows.find((r) => r.type === "All Branchs Total" || r.type === "Branch total" || r.type === "Aftersales Total") ?? rows[0];

// ---------- Daily sales ----------

export function DailyTab({ report, extra }: { report: MsiReport; extra: MsiExtra }) {
  const runDay = Number(report.reportDate.slice(8, 10));
  const scopes = useMemo(() => scopesOf(extra.daily, (r) => r.days.some((d) => d)), [extra.daily]);
  const [scope, setScope] = useState(scopes[0]?.id ?? "KSA");
  const rows = extra.daily.filter((r) => r.scope === scope);
  const top = headline(rows) as DailyRow | undefined;
  const dayNumbers = Array.from({ length: runDay }, (_, i) => i + 1);
  if (!extra.daily.length) return <Empty>The report has no daily sales sheet.</Empty>;
  return (
    <>
      <Panel
        title="Daily net sales"
        eyebrow={`1 – ${runDay} ${MONTHS[report.meta.month - 1]} ${report.meta.year}`}
        subtitle="What was invoiced each day against the day's target (Fridays have no sales)"
        action={<Chips value={scope} onChange={setScope} items={scopes} label="Branch" />}
      >
        {top ? (
          <GroupedColumns
            groups={dayNumbers.map((d) => ({ label: String(d), values: [top.days[d - 1] ?? 0, top.dailyTarget ?? 0] as [number, number] }))}
            seriesNames={["Sold", "Daily target"]}
            colors={[C.red, C.blueLight]}
            format={(v) => money(v)}
          />
        ) : (
          <Empty>No daily figures for this branch.</Empty>
        )}
      </Panel>
      <Panel title="Day by day" subtitle="Every line of the report for the chosen branch">
        <TableWrap>
          <table className="w-full min-w-[900px] text-xs">
            <thead className="bg-[#f5f5f7]">
              <tr>
                <th className={`${th} sticky left-0 bg-[#f5f5f7]`}>Line</th>
                <th className={thr}>Month target</th>
                <th className={thr}>Daily target</th>
                {dayNumbers.map((d) => (
                  <th key={d} className={thr}>
                    {d}
                  </th>
                ))}
                <th className={thr}>Sold so far</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ececec]">
              {rows.map((r, i) => {
                const sum = r.days.slice(0, runDay).reduce<number>((s, v) => s + (v ?? 0), 0);
                return (
                  <tr key={`${r.type}|${r.channel}|${i}`} className={i === 0 ? "bg-[#fafafa] font-semibold" : ""}>
                    <td className={`${td} sticky left-0 bg-inherit`}>
                      {r.part === "Breakdown" ? "" : ""}
                      {r.type} <span className="text-[#6e6e73]">· {r.channel}</span>
                    </td>
                    <td className={tdr}>{money(r.monthTarget)}</td>
                    <td className={tdr}>{money(r.dailyTarget)}</td>
                    {dayNumbers.map((d) => (
                      <td key={d} className={tdr}>
                        {r.days[d - 1] ? money(r.days[d - 1]) : <span className="text-[#c7c7cc]">–</span>}
                      </td>
                    ))}
                    <td className={`${tdr} font-semibold`}>{money(sum)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Panel>
    </>
  );
}

// ---------- Monthly closing ----------

const METRICS = [
  { id: "actual", label: "Actual" },
  { id: "target", label: "Target" },
  { id: "pct", label: "% of target" },
  { id: "avg", label: "Average per day" },
] as const;

export function MonthlyTab({ report, extra }: { report: MsiReport; extra: MsiExtra }) {
  const scopes = useMemo(() => scopesOf(extra.monthly, (r) => r.months.some((c) => c.actual)), [extra.monthly]);
  const [scope, setScope] = useState("KSA");
  const [metric, setMetric] = useState<(typeof METRICS)[number]["id"]>("actual");
  const rows = extra.monthly.filter((r) => r.scope === scope);
  const top = headline(rows) as MonthlyRow | undefined;
  const curMonth = report.meta.month;
  if (!extra.monthly.length) return <Empty>The report has no monthly closing sheet.</Empty>;
  const show = (c: { actual: number | null; target: number | null; pct: number | null; avg: number | null }) => (metric === "pct" ? <Pct v={c.pct} /> : money(c[metric]));
  return (
    <>
      <Panel
        title="Monthly closing"
        eyebrow={`${report.meta.year} · January to December`}
        subtitle="Each month's closing sales against its target; the current month is the month to date"
        action={<Chips value={scope} onChange={setScope} items={scopes} label="Branch" />}
      >
        {top && (
          <GroupedColumns
            groups={top.months.map((c, i) => ({ label: MONTHS[i], values: [c.actual ?? 0, c.target ?? 0] as [number, number] }))}
            seriesNames={["Actual", "Target"]}
            colors={[C.red, C.blueLight]}
            format={(v) => money(v)}
            highlight={(i) => i + 1 === curMonth}
          />
        )}
      </Panel>
      <Panel title="Every line" action={<Chips value={metric} onChange={setMetric} items={METRICS.map((m) => ({ id: m.id, label: m.label }))} label="Figure" />}>
        <TableWrap>
          <table className="w-full min-w-[1100px] text-xs">
            <thead className="bg-[#f5f5f7]">
              <tr>
                <th className={`${th} sticky left-0 bg-[#f5f5f7]`}>Line</th>
                {MONTHS.map((m, i) => (
                  <th key={m} className={`${thr} ${i + 1 === curMonth ? "text-[#c4121a]" : ""}`}>
                    {m}
                  </th>
                ))}
                <th className={thr}>YTD</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ececec]">
              {rows.map((r, i) => (
                <tr key={`${r.type}|${r.channel}|${i}`} className={i === 0 ? "bg-[#fafafa] font-semibold" : ""}>
                  <td className={`${td} sticky left-0 bg-inherit`}>
                    {r.type} <span className="text-[#6e6e73]">· {r.channel}</span>
                  </td>
                  {r.months.map((c, mi) => (
                    <td key={mi} className={`${tdr} ${mi + 1 === curMonth ? "bg-[#fff5f5]" : ""}`}>
                      {c.actual == null && c.target == null ? <span className="text-[#c7c7cc]">–</span> : show(c)}
                    </td>
                  ))}
                  <td className={`${tdr} font-semibold`}>{show(r.ytd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Panel>
    </>
  );
}

// ---------- KPIs ----------

const CHANNELS = ["Total", "Internal", "Retail", "Warranty"];

export function KpisTab({ report, extra }: { report: MsiReport; extra: MsiExtra }) {
  const [month, setMonth] = useState(report.meta.month);
  const [channel, setChannel] = useState("Total");
  const rows = extra.kpis.filter((k: KpiRow) => k.channel === channel);
  if (!extra.kpis.length) return <Empty>The report has no KPIs sheet.</Empty>;
  const cur = (k: KpiRow) => k.months[month - 1];
  const prev = (k: KpiRow) => (month > 1 ? k.months[month - 2] : null);
  const change = (a: number | null | undefined, b: number | null | undefined) => (a != null && b ? (a - b) / b : null);
  return (
    <Panel
      title="Labor and workshop-parts KPIs"
      eyebrow={`${MONTHS[month - 1]} ${report.meta.year}`}
      subtitle="Labor sales, sold hours, recovery rate (labor sales per sold hour) and the parts-to-labor ratio, per branch"
      action={
        <div className="flex flex-wrap items-center gap-3">
          <Chips value={String(month)} onChange={(v) => setMonth(Number(v))} label="Month" items={MONTHS.slice(0, report.meta.month).map((m, i) => ({ id: String(i + 1), label: m }))} />
        </div>
      }
    >
      <div className="mb-3">
        <Chips value={channel} onChange={setChannel} label="Sales channel" items={CHANNELS.map((c) => ({ id: c, label: c }))} />
      </div>
      <TableWrap>
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-[#f5f5f7]">
            <tr>
              <th className={th}>Branch</th>
              <th className={thr}>Labor sales</th>
              <th className={thr}>vs last month</th>
              <th className={thr}>Sold hours</th>
              <th className={thr}>Recovery rate</th>
              <th className={thr}>Workshop parts</th>
              <th className={thr}>Parts : labor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#ececec]">
            {rows.map((k) => {
              const c = cur(k);
              const empty = c.labor == null && c.hours == null;
              const d = change(c.labor, prev(k)?.labor);
              return (
                <tr key={k.branch} className={`${k.branch === "Grand Total" ? "bg-[#fafafa] font-semibold" : ""} ${empty ? "text-[#6e6e73]" : ""}`}>
                  <td className={td}>{k.branch === "Grand Total" ? "All branches" : k.branch}</td>
                  <td className={tdr}>{money(c.labor)}</td>
                  <td className={tdr}>
                    {d == null ? "—" : <span className={d >= 0 ? "text-[#248a3d]" : "text-[#d70015]"}>{`${d >= 0 ? "+" : ""}${pct(d)}`}</span>}
                  </td>
                  <td className={tdr}>{dec(c.hours, 1)}</td>
                  <td className={tdr}>{dec(c.recovery, 1)}</td>
                  <td className={tdr}>{money(c.parts)}</td>
                  <td className={tdr}>{dec(c.ratio, 2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
      <p className="mt-3 text-xs text-[#6e6e73]">Recovery rate = labor sales per sold hour (warranty is paid at a fixed rate). Parts : labor = workshop parts sold for each riyal of labor.</p>
    </Panel>
  );
}

// ---------- Wholesale & Affiliates ----------

export function WholesaleTab({ report }: { report: MsiReport }) {
  const rows = report.wholesale;
  if (!rows.length) return <Empty>The report has no Wholesale &amp; Affiliates sheet.</Empty>;
  const m = report.meta;
  return (
    <Panel title="Wholesale & Affiliates" eyebrow="Actual · MTD target · month target · closing forecast" subtitle="Wholesale parts and body-parts affiliates: the KSA total, each region and each salesman">
      <TableWrap>
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-[#f5f5f7]">
            <tr>
              <th className={th}>Name</th>
              <th className={th}>Channel</th>
              <th className={thr}>Actual (MTD)</th>
              <th className={thr}>MTD target</th>
              <th className={thr}>vs MTD</th>
              <th className={thr}>Month target</th>
              <th className={thr}>Reached</th>
              <th className={thr}>Closing forecast</th>
              <th className={thr}>Forecast vs target</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#ececec]">
            {rows.map((r, i) => (
              <tr key={`${r.name}|${i}`} className={r.isTotal ? "bg-[#f5f5f7] font-semibold" : ""}>
                <td className={`${td} ${r.isTotal ? "" : "pl-6"}`}>{r.name}</td>
                <td className={`${td} text-[#6e6e73]`}>{r.isTotal ? "" : r.channel}</td>
                <td className={tdr}>{money(r.actual)}</td>
                <td className={tdr}>{money(r.mtdTarget)}</td>
                <td className={tdr}>
                  <Pct v={r.mtdPct} />
                </td>
                <td className={tdr}>{money(r.monthTarget)}</td>
                <td className={tdr}>
                  <Pct v={r.monthPct} good={m.workingDays ? (m.daysPassed ?? 0) / m.workingDays : 1} />
                </td>
                <td className={tdr}>{money(r.forecast)}</td>
                <td className={tdr}>
                  <Pct v={r.forecast != null && r.monthTarget ? r.forecast / r.monthTarget : null} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Panel>
  );
}
