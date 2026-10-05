import type { CycleMetric } from "@/lib/dashboard/kpis";
import { C, GroupedColumns, Meter, StackedBar } from "@/components/dashboard/charts";
import { Card, Icon, IconBadge, Label, Metric, Panel, Pill, fmtDate, fmtDays, fmtInt } from "@/components/dashboard/ui";
import type { SectionProps } from "./overview";

const BUCKET_COLORS = [C.blue, C.blueSoft, C.amber, C.red];

function CycleCard({
  title,
  formula,
  metric,
  accent,
  icon,
}: {
  title: string;
  formula: string;
  metric: CycleMetric;
  accent: string;
  icon: React.ReactNode;
}) {
  const n = metric.buckets.reduce((s, b) => s + b.count, 0);
  return (
    <Card accent={accent} className="flex flex-col justify-between gap-3">
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <Label>{title}</Label>
          <span style={{ color: accent }}>{icon}</span>
        </div>
        <Metric value={fmtDays(metric.avg)} unit="days avg" />
        <div className="text-[11px] text-[#575e70]">
          Median <strong className="text-[#0b1c30]">{fmtDays(metric.median)}d</strong> · {fmtInt(n)} records
        </div>
      </div>
      <div className="rounded-lg bg-[#eff4ff] p-2">
        <div className="mb-1 text-[10px] font-semibold tracking-wider text-[#575e70] uppercase">{formula}</div>
        <StackedBar
          height="h-2.5"
          legend={false}
          segments={metric.buckets.map((b, i) => ({ label: b.label, value: b.count, color: BUCKET_COLORS[i] }))}
        />
        <div className="mt-1 grid grid-cols-4 gap-1 text-center text-[10px] text-[#575e70]">
          {metric.buckets.map((b, i) => (
            <span key={b.label} className="truncate">
              <span className="font-semibold" style={{ color: BUCKET_COLORS[i] }}>
                {b.label}
              </span>
              <br />
              {n ? `${Math.round((b.count / n) * 100)}%` : "—"}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function CycleTimesSection({ data }: SectionProps) {
  const c = data.cycle;
  const lifecycleMax = Math.max(...c.lifecycle.map((s) => s.avg ?? 0), 1);
  const lifecycleTotal = c.lifecycle.reduce((s, x) => s + (x.avg ?? 0), 0);
  const series = data.seriesStats.slice(0, 8);
  const seriesMax = Math.max(...series.map((s) => s.avgRepairDays ?? 0), 1);
  const overall = c.repair.avg;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <CycleCard title="Job card → submit" formula="First submit − job card open" metric={c.endToEnd} accent={C.primary} icon={<Icon.timer />} />
        <CycleCard title="Repair completion" formula="Repair end − job card open" metric={c.repair} accent={C.slate} icon={<Icon.wrench />} />
        <CycleCard title="Claim submission" formula="First submit − repair end" metric={c.submission} accent={C.red} icon={<Icon.upload />} />
        <CycleCard title="Self audit submission" formula="Admin completion − officer generate" metric={c.selfAudit} accent={C.blue} icon={<Icon.check />} />
        <CycleCard title="Scrap evidence" formula="Evidence submitted − officer generate" metric={c.scrapEvidence} accent={C.blueLight} icon={<Icon.trash />} />
      </div>

      <Panel
        title="End-to-end warranty lifecycle"
        subtitle="Average days per stage, from job card open to SAIC settlement"
        action={<Pill tone="blue">{fmtDays(lifecycleTotal)} days total</Pill>}
      >
        <div className="space-y-2.5">
          {c.lifecycle.map((s, i) => {
            const longest = s.avg != null && s.avg === Math.max(...c.lifecycle.map((x) => x.avg ?? 0));
            return (
              <div key={s.stage} className="group grid grid-cols-12 items-center gap-3">
                <div className="col-span-12 flex items-center justify-between gap-2 sm:col-span-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-[11px] font-bold ${longest ? "bg-[#9a000d] text-white" : "bg-[#dce9ff] text-[#575e70]"}`}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <div className={`text-sm font-semibold ${longest ? "text-[#9a000d]" : "text-[#0b1c30]"}`}>{s.stage}</div>
                      <div className="truncate text-[11px] text-[#575e70]">{s.detail}</div>
                    </div>
                  </div>
                </div>
                <div className="col-span-10 sm:col-span-7">
                  <div className="relative h-7 overflow-hidden rounded-lg bg-[#eff4ff]">
                    <div
                      className="flex h-full items-center rounded px-3 text-[11px] font-bold whitespace-nowrap text-white"
                      style={{ width: `${Math.max(((s.avg ?? 0) / lifecycleMax) * 100, 8)}%`, backgroundColor: longest ? C.primary : C.blue }}
                    >
                      {fmtDays(s.avg)} days
                    </div>
                  </div>
                </div>
                <div className="col-span-2 text-right sm:col-span-1">
                  <span className="text-[11px] font-semibold text-[#575e70]">{fmtInt(s.claims)}</span>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] text-[#575e70]">
          Right-hand number = claims with both dates. Verification and settlement only count claims SAIC has already processed. The longest stage is highlighted.
        </p>
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Panel
          className="lg:col-span-7"
          title="Work-week rhythm: repaired vs submitted"
          subtitle="Claims finishing repair vs claims first submitted to SAIC, per day of the week"
        >
          <GroupedColumns
            seriesNames={["Repairs finished", "Claims submitted"]}
            colors={[C.slate, C.red]}
            format={fmtInt}
            highlight={(i) => data.weekdays[i].dow === 4}
            groups={data.weekdays.map((d) => ({
              label: d.dow === 4 ? "THU (½)" : d.label.toUpperCase(),
              sub: `${d.days} days`,
              values: [d.repaired, d.submitted],
            }))}
          />
          <div className="mt-4 grid grid-cols-3 gap-3">
            {[
              { label: "Repairs finished", value: fmtInt(data.weekdays.reduce((s, d) => s + d.repaired, 0)) },
              { label: "Claims submitted", value: fmtInt(data.weekdays.reduce((s, d) => s + d.submitted, 0)) },
              { label: "Avg claims / working day", value: fmtDays(data.totals.avgDailyClaims) },
            ].map((x) => (
              <div key={x.label} className="rounded-lg bg-[#eff4ff] p-2.5">
                <Label>{x.label}</Label>
                <div className="font-display text-lg font-semibold text-[#0b1c30]">{x.value}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="lg:col-span-5" title="Repair days by model" subtitle="Average job card open → repair end, top models by volume" action={<IconBadge tone="slate"><Icon.car /></IconBadge>}>
          <div className="space-y-2">
            {series.map((s) => {
              const slow = overall != null && (s.avgRepairDays ?? 0) > overall;
              return (
                <div key={s.series} className="rounded-lg bg-[#eff4ff] p-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-[#0b1c30]">{s.series}</span>
                    <span className="flex items-center gap-2">
                      <span className={`text-xs font-semibold ${slow ? "text-[#9a000d]" : "text-[#0b1c30]"}`}>{fmtDays(s.avgRepairDays)}d avg</span>
                      <Pill tone="muted">{fmtInt(s.count)} claims</Pill>
                    </span>
                  </div>
                  <Meter pct={((s.avgRepairDays ?? 0) / seriesMax) * 100} color={slow ? C.red : C.blue} />
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between rounded-lg bg-[#eff4ff] px-3 py-2 text-xs">
            <span className="text-[#575e70]">All models average</span>
            <span className="font-bold text-[#0b1c30]">{fmtDays(overall)} days</span>
          </div>
        </Panel>
      </div>

      <Panel
        title="Slowest claims"
        subtitle="Longest job card open → first submit in this period"
        action={<Pill tone="bad">{data.slowestClaims.length} shown</Pill>}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#eff4ff] text-[11px] font-bold tracking-wider text-[#575e70] uppercase">
              <tr>
                <th className="px-3 py-2.5">Job card / VIN</th>
                <th className="px-3 py-2.5">Model</th>
                <th className="px-3 py-2.5">Labor</th>
                <th className="px-3 py-2.5">Job card open</th>
                <th className="px-3 py-2.5">Repair</th>
                <th className="px-3 py-2.5">Submission</th>
                <th className="px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e5eeff]">
              {data.slowestClaims.map((r) => {
                const total = (r.repairDays ?? 0) + (r.submitDays ?? 0);
                return (
                  <tr key={r.claimNumber} className="hover:bg-[#eff4ff]/50">
                    <td className="px-3 py-2.5">
                      <div className="font-bold text-[#0b1c30]">{r.workOrderNo ?? r.claimNumber}</div>
                      <div className="font-mono text-[11px] text-[#575e70]">{r.vin ?? r.claimNumber}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-semibold">{r.series ?? "—"}</div>
                      <div className="text-[11px] text-[#575e70]">{r.branch}</div>
                    </td>
                    <td className="max-w-56 truncate px-3 py-2.5 text-xs text-[#575e70]" title={r.laborName ?? undefined}>
                      {r.laborName ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap text-[#575e70]">{fmtDate(r.openDate)}</td>
                    <td className="px-3 py-2.5">
                      <div className="w-28 space-y-1">
                        <div className="text-xs font-bold text-[#9a000d]">{fmtDays(r.repairDays)} days</div>
                        <Meter pct={total ? ((r.repairDays ?? 0) / total) * 100 : 0} color={C.red} height="h-1.5" />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs font-semibold whitespace-nowrap">{r.submitDays == null ? "Not submitted" : `${fmtDays(r.submitDays)} days`}</td>
                    <td className="px-3 py-2.5">
                      <Pill tone="muted">{r.status ?? "—"}</Pill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
