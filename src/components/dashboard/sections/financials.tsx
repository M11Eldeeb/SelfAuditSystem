import { BarList, C, Donut, GroupedColumns, Meter, Ring, StackedBar, dayShort, monthShort } from "@/components/dashboard/charts";
import { Card, Icon, IconBadge, Label, Metric, Panel, Pill, fmtCompact, fmtInt, fmtMoney, fmtNum, fmtPct } from "@/components/dashboard/ui";
import type { SectionProps } from "./overview";
import { ReconProgress } from "./recon-progress";

const STATUS_TONE: Record<string, "good" | "warn" | "bad" | "muted" | "blue"> = {
  Settled: "good",
  Approved: "good",
  "To be settled": "blue",
  Closed: "muted",
  Rejected: "bad",
};

export function FinancialsSection({ data, onOpenReconciliation }: SectionProps & { onOpenReconciliation?: () => void }) {
  const t = data.totals;
  const cur = data.currency;
  const cost = data.costSplit;
  const costTotal = cost.part + cost.labor + cost.sublet;
  const costSegments = [
    { label: "Parts", value: cost.part, color: C.red },
    { label: "Labor", value: cost.labor, color: C.blueLight },
    { label: "Sublet", value: cost.sublet, color: C.slate },
  ];
  const biggest = [...costSegments].sort((a, b) => b.value - a.value)[0];
  const returned = t.submittedCount - t.acceptedFirstTime;
  const topSeries = data.seriesStats.slice(0, 3);
  const acvMax = Math.max(...topSeries.map((s) => (s.count ? s.amount / s.count : 0)), 1);
  const statusTotal = data.statusCounts.reduce((s, x) => s + x.count, 0) || 1;
  const byAmount = [...data.topLaborCodes].sort((a, b) => b.amount - a.amount).slice(0, 10);

  return (
    <div className="space-y-5">
      <ReconProgress data={data} onOpen={onOpenReconciliation} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card accent={C.red} className="flex flex-col justify-between gap-3">
          <div>
            <Label>Gross claims</Label>
            <Metric value={fmtMoney(t.totalClaimAmount)} unit={cur} />
            <div className="flex justify-between text-xs text-[#575e70]">
              <span>{fmtInt(t.claimCount)} claims</span>
              <span className="font-semibold text-[#0b1c30]">Adjusted {fmtMoney(t.totalAdjustedAmount)}</span>
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-[#575e70]">Kept after SAIC adjustment</span>
              <span className="font-bold text-[#9a000d]">
                {t.totalClaimAmount ? fmtPct((t.totalAdjustedAmount / t.totalClaimAmount) * 100) : "—"}
              </span>
            </div>
            <Meter pct={t.totalClaimAmount ? (t.totalAdjustedAmount / t.totalClaimAmount) * 100 : 0} color={C.red} />
          </div>
        </Card>

        <Card accent={C.green} className="flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <Label>First-pass acceptance</Label>
            <Pill tone="good">Top box</Pill>
          </div>
          <div className="flex items-center gap-3">
            <Ring pct={t.topBoxPct} size={84} center={fmtPct(t.topBoxPct)} caption="top box" color={C.green} />
            <div className="w-full space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="flex items-center gap-1 text-[#575e70]">
                  <span className="h-2 w-2 rounded-full bg-emerald-600" />
                  Accepted 1st time
                </span>
                <span className="font-bold">{fmtInt(t.acceptedFirstTime)}</span>
              </div>
              <div className="flex justify-between">
                <span className="flex items-center gap-1 text-[#575e70]">
                  <span className="h-2 w-2 rounded-full bg-[#c4121a]" />
                  Returned
                </span>
                <span className="font-bold">{fmtInt(returned)}</span>
              </div>
              <div className="flex justify-between">
                <span className="flex items-center gap-1 text-[#575e70]">
                  <span className="h-2 w-2 rounded-full bg-[#c0c6db]" />
                  Not submitted
                </span>
                <span className="font-bold">{fmtInt(t.claimCount - t.submittedCount)}</span>
              </div>
            </div>
          </div>
        </Card>

        <Card accent={C.blue} className="flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <Label>Detected amount</Label>
            <Pill tone="blue">{fmtInt(t.adjustedClaimCount)} adjusted</Pill>
          </div>
          <Metric value={fmtMoney(t.detectedAmount)} unit={cur} tone={t.detectedAmount < 0 ? "red" : undefined} />
          <div>
            <StackedBar
              legend={false}
              height="h-3"
              segments={[
                { label: "Labor", value: Math.abs(data.detectedSplit.labor), color: C.blue },
                { label: "Parts", value: Math.abs(data.detectedSplit.part), color: C.blueSoft },
                { label: "Sublet", value: Math.abs(data.detectedSplit.sublet), color: C.red },
              ]}
            />
            <div className="mt-1.5 grid grid-cols-3 text-center">
              {[
                { l: "Labor", v: data.detectedSplit.labor, c: "text-[#0041b0]" },
                { l: "Parts", v: data.detectedSplit.part, c: "text-[#5c6274]" },
                { l: "Sublet", v: data.detectedSplit.sublet, c: "text-[#9a000d]" },
              ].map((x) => (
                <div key={x.l}>
                  <div className="text-[10px] font-bold text-[#575e70] uppercase">{x.l}</div>
                  <div className={`text-xs font-bold ${x.c}`}>{fmtCompact(x.v)}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card accent={C.slate} className="flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <Label>Average claim value</Label>
            <IconBadge tone="slate">
              <Icon.receipt />
            </IconBadge>
          </div>
          <Metric value={fmtNum(t.avgClaimValue, 2)} unit={`${cur} / claim`} />
          <div className="space-y-1.5">
            {topSeries.map((s, i) => {
              const acv = s.count ? s.amount / s.count : 0;
              return (
                <div key={s.series} className="space-y-0.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-[#575e70]">{s.series}</span>
                    <span className="font-bold">{fmtMoney(acv)}</span>
                  </div>
                  <Meter pct={(acv / acvMax) * 100} color={[C.red, C.blue, C.slate][i]} height="h-1.5" />
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Panel
          className="lg:col-span-8"
          eyebrow="Settlement trajectory"
          title="Claimed vs adjusted"
          subtitle={`Per ${data.periodUnit === "week" ? "week (Sat–Thu)" : "month"} by repair end date`}
        >
          <GroupedColumns
            seriesNames={[`Claim TOL. (${cur})`, `Adjusted (${cur})`]}
            colors={[C.blueLight, C.green]}
            format={fmtCompact}
            groups={data.periods.map((p) => ({
              label: data.periodUnit === "week" ? `Wk ${dayShort(p.label)}` : monthShort(p.label),
              sub: `${fmtInt(p.count)} claims`,
              values: [p.claimed, p.adjusted],
            }))}
            line={{
              name: "Detected",
              color: C.red,
              values: data.periods.map((p) => p.adjusted - p.claimed),
              format: (v) => fmtCompact(v),
            }}
          />
          <div className="mt-4 grid grid-cols-3 gap-3 rounded-lg bg-[#eff4ff] p-3">
            <div>
              <Label>Claimed</Label>
              <div className="font-display text-lg font-semibold">{fmtMoney(t.totalClaimAmount)}</div>
            </div>
            <div>
              <Label>Adjusted</Label>
              <div className="font-display text-lg font-semibold">{fmtMoney(t.totalAdjustedAmount)}</div>
            </div>
            <div>
              <Label>Detected</Label>
              <div className="font-display text-lg font-semibold text-[#9a000d]">{fmtMoney(t.detectedAmount)}</div>
            </div>
          </div>
        </Panel>

        <Panel className="lg:col-span-4" eyebrow="Cost mix" title="Cost breakdown" subtitle="Before SAIC adjustment">
          <Donut
            segments={costSegments}
            center={costTotal ? `${Math.round((biggest.value / costTotal) * 100)}%` : "—"}
            caption={biggest.label}
          />
          <div className="mt-4 space-y-2.5">
            {costSegments.map((s) => (
              <div key={s.label} className="space-y-1">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
                    {s.label} ({costTotal ? Math.round((s.value / costTotal) * 100) : 0}%)
                  </span>
                  <span>{fmtMoney(s.value)}</span>
                </div>
                <Meter pct={costTotal ? (s.value / costTotal) * 100 : 0} color={s.color} height="h-1.5" />
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Panel className="lg:col-span-4" eyebrow="Claim status" title="Where claims stand" subtitle="Current status of claims in this period">
          <div className="space-y-2.5">
            {data.statusCounts.slice(0, 8).map((s) => (
              <div key={s.label} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <Pill tone={STATUS_TONE[s.label] ?? (s.label.toLowerCase().includes("return") ? "warn" : "muted")}>{s.label}</Pill>
                  <span className="text-[#575e70]">
                    <strong className="text-[#0b1c30]">{fmtInt(s.count)}</strong> · {fmtCompact(s.amount)}
                  </span>
                </div>
                <Meter pct={(s.count / statusTotal) * 100} color={STATUS_TONE[s.label] === "good" ? C.green : STATUS_TONE[s.label] === "bad" ? C.red : C.blue} height="h-1.5" />
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="lg:col-span-8" eyebrow="Root cause" title="Labor codes by claim amount" subtitle="Top 10 labor codes by total claimed">
          <BarList
            color={C.blue}
            valueLabel="Amount · claims"
            items={byAmount.map((l) => ({
              label: l.sublabel ?? l.label,
              sublabel: l.sublabel ? l.label : undefined,
              value: l.amount,
              display: fmtMoney(l.amount),
              secondary: `${fmtInt(l.count)} claims`,
            }))}
          />
        </Panel>
      </div>

      <Panel eyebrow="Priority scrutiny" title="High-value claims" subtitle="Top 10 claims by Claim TOL. in this period">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#eff4ff] text-[11px] font-bold tracking-wider text-[#575e70] uppercase">
              <tr>
                <th className="px-3 py-2.5">Claim / VIN</th>
                <th className="px-3 py-2.5">Model & labor</th>
                <th className="px-3 py-2.5">Main part</th>
                <th className="px-3 py-2.5 text-right">Claim TOL.</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5 text-right">Detected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e5eeff]">
              {data.highValueClaims.map((r) => {
                const delta = r.adjusted - r.amount;
                return (
                  <tr key={r.claimNumber} className="hover:bg-[#eff4ff]/50">
                    <td className="px-3 py-2.5">
                      <div className="font-bold text-[#0b1c30]">{r.claimNumber}</div>
                      <div className="font-mono text-[11px] text-[#575e70]">{r.vin ?? r.workOrderNo}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-semibold">{r.series ?? "—"} · <span className="text-[11px] font-normal text-[#575e70]">{r.branch}</span></div>
                      <div className="max-w-64 truncate text-[11px] text-[#9a000d]" title={r.laborName ?? undefined}>{r.laborName ?? "—"}</div>
                    </td>
                    <td className="max-w-48 truncate px-3 py-2.5 text-xs" title={r.partName ?? undefined}>
                      {r.partName ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right font-display font-bold whitespace-nowrap">{fmtNum(r.amount, 2)}</td>
                    <td className="px-3 py-2.5">
                      <Pill tone={STATUS_TONE[r.status ?? ""] ?? "muted"}>{r.status ?? "—"}</Pill>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {Math.abs(delta) < 0.005 ? (
                        <Pill tone="good">0.00</Pill>
                      ) : (
                        <Pill tone="bad">{fmtNum(delta, 2)}</Pill>
                      )}
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
