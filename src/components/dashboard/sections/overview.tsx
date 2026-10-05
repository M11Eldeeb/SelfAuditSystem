import Link from "next/link";
import type { DashboardData, ScorePoint } from "@/lib/dashboard/kpis";
import { BarList, C, LineChart, Meter, Ring, SERIES_COLORS, StackedBar, type LineSeries } from "@/components/dashboard/charts";
import { Card, Icon, IconBadge, Label, Metric, Panel, Pill, fmtCompact, fmtDays, fmtInt, fmtMoney, fmtNum, fmtPct } from "@/components/dashboard/ui";

export type SectionProps = {
  data: DashboardData;
  scopeBranches: { id: string; name: string }[];
  isOfficer: boolean;
};

/**
 * One line per branch in scope. Several audits for the same branch in the
 * same month are averaged.
 */
function toSeries(points: ScorePoint[], branches: { id: string; name: string }[]): LineSeries[] {
  return branches
    .map((b, i) => {
      const byMonth = new Map<string, number[]>();
      for (const p of points.filter((p) => p.branchId === b.id)) byMonth.set(p.month, [...(byMonth.get(p.month) ?? []), p.score]);
      return {
        name: b.name,
        color: SERIES_COLORS[i % SERIES_COLORS.length],
        points: [...byMonth.entries()].map(([month, scores]) => ({ month, value: scores.reduce((s, v) => s + v, 0) / scores.length })),
      };
    })
    .filter((s) => s.points.length > 0);
}

export function OverviewSection({ data, scopeBranches, isOfficer }: SectionProps) {
  // Where each pending task gets done: branch admins go straight to the
  // audit form / evidence upload, officers to the matching review page.
  const selfAuditHref = (p: (typeof data.pending)[number]) =>
    isOfficer
      ? `/admin/review/${p.selfAudit!.cycleId}/${p.branchId}`
      : p.selfAudit!.firstPendingAssignmentId
        ? `/audit/${p.selfAudit!.firstPendingAssignmentId}`
        : "/audit";
  const evidenceHref = (p: (typeof data.pending)[number]) =>
    isOfficer ? `/admin/warranty-room/destroy-evidence/${p.scrapEvidence!.cycleId}` : "/audit/warranty-room";
  const t = data.totals;
  const cur = data.currency;
  const returned = t.submittedCount - t.acceptedFirstTime;
  const pendingSelfAudit = data.pending.reduce((s, p) => s + (p.selfAudit?.pending ?? 0), 0);
  const pendingEvidence = data.pending.filter((p) => p.scrapEvidence?.status === "not_submitted").length;
  const pendingTotal = pendingSelfAudit + pendingEvidence;
  const fullDays = data.weekdays.filter((d) => d.dow !== 4);
  const fullDayAvg =
    fullDays.reduce((s, d) => s + d.repaired, 0) / Math.max(fullDays.reduce((s, d) => s + d.days, 0), 1);
  const cycleRows = [
    { label: "Repair completion", formula: "Repair end − job card open", v: t.avgRepairCompletionDays, color: C.slate },
    { label: "Claim submission", formula: "First submit − repair end", v: t.avgClaimSubmissionDays, color: C.red },
    { label: "Self audit submission", formula: "Admin completion − officer generate", v: t.avgSelfAuditDays, color: C.blueLight },
    { label: "Scrap evidence submission", formula: "Evidence submitted − officer generate", v: t.avgScrapEvidenceDays, color: C.primary },
  ];
  const cycleMax = Math.max(...cycleRows.map((r) => r.v ?? 0), 1);
  const topModels = data.topVehicles.slice(0, 5);
  const modelTotal = t.claimCount || 1;

  return (
    <div className="space-y-5">
      {/* Headline cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12">
        <Card className="flex flex-col justify-between gap-3 xl:col-span-4" accent={C.red}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <Label>Claims in period</Label>
              <div className="font-display text-base font-semibold text-[#0b1c30]">Total claim amount</div>
            </div>
            <IconBadge>
              <Icon.check />
            </IconBadge>
          </div>
          <div>
            <Metric value={fmtMoney(t.totalClaimAmount)} unit={cur} />
            <div className="text-xs text-[#575e70]">
              <strong className="text-[#0b1c30]">{fmtInt(t.claimCount)}</strong> claims · {fmtInt(t.wipCount)} job cards ·{" "}
              {fmtNum(t.claimsPerWip, 2)} claims per WIP
            </div>
          </div>
          <div className="space-y-1 border-t border-[#e5eeff] pt-2">
            <div className="flex justify-between text-[11px]">
              <span className="text-[#575e70]">Avg daily claims (Sat–Wed full, Thu half)</span>
              <span className="font-bold text-[#9a000d]">{fmtNum(t.avgDailyClaims)} / day</span>
            </div>
            <div className="flex justify-between text-[11px] text-[#575e70]">
              <span>{fmtNum(t.workingDays, 1)} working days</span>
              <span>Avg claim value {fmtMoney(t.avgClaimValue ?? 0)}</span>
            </div>
          </div>
        </Card>

        <Card className="flex flex-col justify-between gap-3 xl:col-span-3" accent={C.green}>
          <div>
            <Label>Quality acceptance</Label>
            <div className="font-display text-base font-semibold text-[#0b1c30]">Warranty claim top box</div>
          </div>
          <div className="flex items-center gap-3">
            <Ring
              pct={t.topBoxPct}
              center={fmtPct(t.topBoxPct)}
              caption="first pass"
              color={(t.topBoxPct ?? 0) >= 90 ? C.green : (t.topBoxPct ?? 0) >= 75 ? C.amber : C.red}
            />
            <div className="min-w-0 flex-1 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-[#575e70]">Accepted 1st time</span>
                <span className="font-bold">{fmtInt(t.acceptedFirstTime)}</span>
              </div>
              <StackedBar
                legend={false}
                height="h-1.5"
                segments={[
                  { label: "Accepted first time", value: t.acceptedFirstTime, color: C.green },
                  { label: "Returned", value: returned, color: C.red },
                ]}
              />
              <div className="flex justify-between text-[11px] text-[#575e70]">
                <span>Returned: {fmtInt(returned)}</span>
                <span>of {fmtInt(t.submittedCount)} submitted</span>
              </div>
            </div>
          </div>
        </Card>

        <Card className="flex flex-col justify-between gap-3 xl:col-span-3" accent={C.blue}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <Label>Audit reconciliation</Label>
              <div className="font-display text-base font-semibold text-[#0b1c30]">Detected amount</div>
            </div>
            <IconBadge tone="blue">
              <Icon.money />
            </IconBadge>
          </div>
          <div>
            <Metric value={fmtMoney(t.detectedAmount)} unit={cur} tone={t.detectedAmount < 0 ? "red" : undefined} />
            <div className="text-[11px] text-[#575e70]">Adjusted claim TOL. − Claim TOL. · {fmtInt(t.adjustedClaimCount)} claims adjusted</div>
          </div>
          <StackedBar
            height="h-2"
            format={(v) => fmtCompact(v)}
            segments={[
              { label: "Labor", value: Math.abs(data.detectedSplit.labor), color: C.blue },
              { label: "Parts", value: Math.abs(data.detectedSplit.part), color: C.blueSoft },
              { label: "Sublet", value: Math.abs(data.detectedSplit.sublet), color: C.red },
            ]}
          />
        </Card>

        <div className="relative flex flex-col justify-between gap-3 overflow-hidden rounded-xl bg-[#9a000d] p-4 text-white shadow-md md:col-span-2 xl:col-span-2">
          <div className="pointer-events-none absolute -right-5 -bottom-5 h-24 w-24 rounded-full bg-white/10" />
          <div className="relative flex items-center justify-between">
            <span className="text-[11px] font-bold tracking-[0.08em] text-white/80 uppercase">Pending tasks</span>
            <Icon.alert />
          </div>
          <div className="relative flex items-baseline gap-1.5">
            <span className="font-display text-4xl leading-none font-bold">{fmtInt(pendingTotal)}</span>
            <span className="text-xs text-white/85">open</span>
          </div>
          <div className="relative space-y-1 rounded-lg bg-white/10 p-2 text-xs">
            <div className="flex justify-between">
              <span>Self audit claims</span>
              <span className="rounded bg-white px-1.5 text-[11px] font-bold text-[#9a000d]">{pendingSelfAudit}</span>
            </div>
            <div className="flex justify-between">
              <span>Scrap evidence</span>
              <span className="rounded bg-white px-1.5 text-[11px] font-bold text-[#9a000d]">{pendingEvidence}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Daily pace + cycle times */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Panel
          className="lg:col-span-7"
          title="Daily claims pace"
          subtitle="Average claims repaired per day of the work week · Thursday is a half day"
          action={<Pill tone="muted">Sat – Thu</Pill>}
        >
          <div className="grid h-52 grid-cols-6 items-end gap-3 px-1">
            {data.weekdays.map((d) => {
              const avg = d.days ? d.repaired / d.days : 0;
              const max = Math.max(...data.weekdays.map((w) => (w.days ? w.repaired / w.days : 0)), 1);
              const thu = d.dow === 4;
              const diff = avg - (thu ? fullDayAvg / 2 : fullDayAvg);
              return (
                <div key={d.dow} className="group flex h-full flex-col items-center justify-end gap-1.5">
                  <Pill tone={diff >= 0 ? "good" : "warn"}>{fmtNum(avg)}</Pill>
                  <div className="relative flex h-full w-full items-end overflow-hidden rounded-t-lg bg-[#eff4ff] p-1">
                    <div
                      className="w-full rounded transition-[filter] group-hover:brightness-110"
                      style={{
                        height: `${(avg / max) * 100}%`,
                        background: thu ? `repeating-linear-gradient(45deg, ${C.red}, ${C.red} 6px, ${C.primary} 6px, ${C.primary} 12px)` : C.red,
                      }}
                      title={`${d.label}: ${d.repaired} claims over ${d.days} days`}
                    />
                  </div>
                  <span className={`text-xs font-bold ${thu ? "text-[#9a000d]" : "text-[#0b1c30]"}`}>{d.label.toUpperCase()}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#eff4ff] px-3 py-2 text-xs text-[#0b1c30]">
            <span>
              Full-day average: <strong>{fmtNum(fullDayAvg)}</strong> claims · Weighted average: <strong>{fmtNum(t.avgDailyClaims)}</strong> per working day
            </span>
            <span className="text-[#575e70]">Green = at or above the full-day (or half-day) average</span>
          </div>
        </Panel>

        <Panel className="lg:col-span-5" title="Cycle times" subtitle="Average days per stage in this period" action={<IconBadge tone="blue"><Icon.timer /></IconBadge>}>
          <div className="space-y-2.5">
            {cycleRows.map((r) => (
              <div key={r.label} className="space-y-1.5 rounded-lg bg-[#eff4ff] p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[#0b1c30]">{r.label}</div>
                    <div className="truncate text-[11px] text-[#575e70]">{r.formula}</div>
                  </div>
                  <div className="font-display text-lg leading-none font-semibold whitespace-nowrap text-[#0b1c30]">
                    {fmtDays(r.v)} <span className="text-[11px] font-medium text-[#575e70]">days</span>
                  </div>
                </div>
                <Meter pct={((r.v ?? 0) / cycleMax) * 100} color={r.color} />
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* Score trends */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel eyebrow="Trend" title="Self audit score" subtitle="Monthly score, all finalized cycles">
          <LineChart series={toSeries(data.selfAuditScores, scopeBranches)} emptyText="No finalized self audits yet." />
        </Panel>
        <Panel eyebrow="Trend" title="Internal audit score" subtitle="Monthly score, all finalized audits">
          <LineChart series={toSeries(data.internalAuditScores, scopeBranches)} emptyText="No finalized internal audits yet." />
        </Panel>
      </div>

      {/* Pending tasks + warranty room + models */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Panel
          className="lg:col-span-8"
          title="Pending tasks"
          subtitle={`Current open self audit and warranty room cycles · click a task to ${isOfficer ? "review" : "complete"} it`}
          action={<Pill tone={pendingTotal ? "bad" : "good"}>{pendingTotal} pending</Pill>}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#eff4ff] text-[11px] font-bold tracking-wider text-[#575e70] uppercase">
                <tr>
                  <th className="px-3 py-2.5">Branch</th>
                  <th className="px-3 py-2.5">Self audit</th>
                  <th className="px-3 py-2.5">Progress</th>
                  <th className="px-3 py-2.5">Scrap evidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5eeff]">
                {data.pending.map((p) => {
                  const sa = p.selfAudit;
                  const done = sa ? sa.total - sa.pending : 0;
                  return (
                    <tr key={p.branchId} className="hover:bg-[#eff4ff]/50">
                      <td className="px-3 py-2.5 font-semibold text-[#0b1c30]">{p.name}</td>
                      <td className="px-3 py-2.5">
                        {sa ? (
                          sa.pending === 0 ? (
                            <Link href={selfAuditHref(p)} className="hover:opacity-80">
                              <Pill tone="good">Submitted · {sa.cycleLabel} →</Pill>
                            </Link>
                          ) : (
                            <Link href={selfAuditHref(p)} className="group block space-y-0.5">
                              <Pill tone={sa.pending === sa.total ? "bad" : "warn"}>
                                {sa.pending} of {sa.total} pending · {isOfficer ? "Review" : "Complete"} →
                              </Pill>
                              {sa.deadline && (
                                <div className="text-[11px] text-[#575e70]">
                                  {sa.cycleLabel} · due{" "}
                                  {new Date(sa.deadline).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Riyadh" })}
                                </div>
                              )}
                            </Link>
                          )
                        ) : (
                          <Pill tone="muted">No open cycle</Pill>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {sa ? (
                          <div className="w-32 space-y-1">
                            <div className="flex justify-between text-[11px] font-semibold">
                              <span>{done}/{sa.total}</span>
                              <span className="text-[#575e70]">{Math.round((done / sa.total) * 100)}%</span>
                            </div>
                            <Meter pct={(done / sa.total) * 100} color={sa.pending ? C.amber : C.green} />
                          </div>
                        ) : (
                          <span className="text-[#c0c6db]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {p.scrapEvidence ? (
                          <Link href={evidenceHref(p)} className="hover:opacity-80">
                            {p.scrapEvidence.status === "not_submitted" ? (
                              <Pill tone="bad">Not submitted · {p.scrapEvidence.cycleLabel} · {isOfficer ? "View" : "Submit"} →</Pill>
                            ) : (
                              <Pill tone="good">
                                {p.scrapEvidence.status === "approved" ? "Approved" : isOfficer ? "Submitted · Review" : "Submitted"} · {p.scrapEvidence.cycleLabel} →
                              </Pill>
                            )}
                          </Link>
                        ) : (
                          <Pill tone="muted">No open cycle</Pill>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="flex flex-col gap-4 lg:col-span-4">
          <Card>
            <div className="flex items-start justify-between">
              <div>
                <Label>Parts in custody</Label>
                <div className="font-display text-base font-semibold text-[#0b1c30]">Warranty room tally</div>
              </div>
              <IconBadge>
                <Icon.box />
              </IconBadge>
            </div>
            <div className="my-3 flex items-center gap-3 rounded-lg bg-[#eff4ff] p-3">
              <Metric value={fmtInt(data.warrantyRoom.parts)} unit="parts held" />
            </div>
            <StackedBar
              height="h-2"
              segments={data.warrantyRoom.aging.map((b, i) => ({ label: b.label, value: b.count, color: [C.green, C.amber, C.red][i] }))}
            />
            <div className="mt-2 border-t border-[#e5eeff] pt-2 text-[11px] text-[#575e70]">
              Do-not-scrap parts, by days into the 90-day holding period · {fmtInt(t.flaggedToScrap)} claims flagged to scrap
            </div>
          </Card>

          <Panel title="Top repaired models" subtitle={`Share of ${fmtInt(t.claimCount)} claims`} className="flex-1">
            <div className="space-y-2">
              {topModels.map((m, i) => (
                <div key={m.label} className="space-y-1 rounded-lg bg-[#eff4ff] p-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-2">
                      <span className={`flex h-6 w-6 items-center justify-center rounded text-[11px] font-bold ${i === 0 ? "bg-[#9a000d] text-white" : "bg-[#dce9ff]"}`}>
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="font-bold text-[#0b1c30]">{m.label}</span>
                      <span className="text-[#575e70]">{fmtInt(m.count)} claims</span>
                    </span>
                    <span className="font-bold text-[#9a000d]">{((m.count / modelTotal) * 100).toFixed(1)}%</span>
                  </div>
                  <Meter pct={(m.count / modelTotal) * 100} color={i === 0 ? C.red : i === 1 ? C.blueLight : C.slate} />
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <Panel title="High frequency labor codes" subtitle="Top 20 by number of claims">
        <BarList
          valueLabel="Claims · amount"
          items={data.topLaborCodes.map((l) => ({
            label: l.sublabel ?? l.label,
            sublabel: l.sublabel ? l.label : undefined,
            value: l.count,
            display: fmtInt(l.count),
            secondary: fmtMoney(l.amount),
          }))}
        />
      </Panel>
    </div>
  );
}
