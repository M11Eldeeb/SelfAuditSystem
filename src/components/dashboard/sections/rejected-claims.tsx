"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import type { RejectedEntry } from "@/lib/dashboard/rejected";
import { C, LineChart } from "@/components/dashboard/charts";
import { Card, Label, Metric, Panel, Pill, fmtInt } from "@/components/dashboard/ui";

type Group = { key: string; count: number };

function groupBy(rows: RejectedEntry[], pick: (r: RejectedEntry) => string[]): Group[] {
  const m = new Map<string, number>();
  for (const r of rows) for (const k of new Set(pick(r).map((x) => x.trim()).filter(Boolean))) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

const monthOf = (d: string) => d.slice(0, 7);
const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** A ranked list; clicking a row lists its diary entries. */
function Ranked({ title, rows, onPick, limit = 8 }: { title: string; rows: Group[]; onPick: (g: Group) => void; limit?: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, limit);
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Panel title={title} className="min-w-0">
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-neutral-500">Nothing in this period.</p>
      ) : (
        <div className="space-y-1">
          {shown.map((g) => (
            <button key={g.key} type="button" onClick={() => onPick(g)} className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-[#f5f5f5]" title="Click to see the entries">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate font-medium text-[#1d1d1f]">{g.key}</span>
                <span className="shrink-0 text-xs font-bold text-[#1d1d1f]">{fmtInt(g.count)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#ececec]">
                <div className="h-full rounded-full" style={{ width: `${(g.count / max) * 100}%`, backgroundColor: C.red }} />
              </div>
            </button>
          ))}
          {rows.length > limit && (
            <button type="button" onClick={() => setAll((v) => !v)} className="mt-1 text-xs font-medium text-[#6e6e73] underline">
              {all ? "Show fewer" : `Show all ${rows.length}`}
            </button>
          )}
        </div>
      )}
    </Panel>
  );
}

/**
 * Overview: the Rejected Claims Diary in numbers - how many claims were rejected in the selected months, the trend over a
 * year, and which branches, service advisors, team leaders, models, labours and parts they concern. Every bar opens the
 * entries behind it, each linking to the diary.
 */
export function RejectedClaimsPanel({ rejected, from, to, diaryPath, showBranches }: { rejected: Promise<RejectedEntry[]>; from: string; to: string; diaryPath: string; showBranches: boolean }) {
  const all = use(rejected);
  const [pick, setPick] = useState<{ title: string; rows: RejectedEntry[] } | null>(null);
  const period = useMemo(() => all.filter((r) => monthOf(r.date) >= from && monthOf(r.date) <= to), [all, from, to]);
  const months = useMemo(() => {
    const [y, m] = to.split("-").map(Number);
    return Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(y, m - 12 + i, 1)).toISOString().slice(0, 7));
  }, [to]);
  const trend = useMemo(() => months.map((mo) => ({ month: mo, value: all.filter((r) => monthOf(r.date) === mo).length })), [all, months]);
  const repeats = period.filter((r) => r.repeat).length;
  const branches = useMemo(() => groupBy(period, (r) => [r.branch]), [period]);
  const advisors = useMemo(() => groupBy(period, (r) => [r.advisor ?? ""]), [period]);
  const leaders = useMemo(() => groupBy(period, (r) => [r.teamLeader ?? ""]), [period]);
  const models = useMemo(() => groupBy(period, (r) => [r.model ?? ""]), [period]);
  const labours = useMemo(() => groupBy(period, (r) => r.labours), [period]);
  const parts = useMemo(() => groupBy(period, (r) => r.parts), [period]);
  const open = (title: string, test: (r: RejectedEntry) => boolean) => setPick({ title, rows: period.filter(test) });
  const prevMonths = trend.slice(0, -1).filter((t) => t.value > 0);
  const avg = prevMonths.length ? prevMonths.reduce((s, t) => s + t.value, 0) / prevMonths.length : 0;

  return (
    <Panel eyebrow="Rejected claims" title="Rejected Claims From The Branch" subtitle="Claims rejected in the selected months - click any number or bar to see the entries" action={<Link href={diaryPath} className="text-xs font-semibold text-[#9a000d] underline">Open Rejected Claims From The Branch</Link>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <button type="button" onClick={() => setPick({ title: "All rejected claims in the period", rows: period })} className="text-left">
            <Card accent={C.red} className="h-full hover:shadow-md">
              <Label>Rejected claims</Label>
              <Metric value={fmtInt(period.length)} unit="in the period" tone="red" />
              <div className="text-xs text-[#6e6e73]">{avg ? `avg ${avg.toFixed(1)} / month over the last year` : "no earlier months"}</div>
            </Card>
          </button>
          <button type="button" onClick={() => open("Repeated rejections (same work order rejected before)", (r) => r.repeat)} className="text-left">
            <Card accent={C.blue} className="h-full hover:shadow-md">
              <Label>Repeated work orders</Label>
              <Metric value={fmtInt(repeats)} unit={period.length ? `${((repeats / period.length) * 100).toFixed(0)}%` : ""} />
              <div className="text-xs text-[#6e6e73]">rejected again after an earlier entry</div>
            </Card>
          </button>
          <Card accent={C.slate} className="h-full">
            <Label>{showBranches ? "Branches affected" : "Service advisors involved"}</Label>
            <Metric value={fmtInt(showBranches ? branches.length : advisors.length)} />
            <div className="text-xs text-[#6e6e73]">{showBranches && branches[0] ? `most: ${branches[0].key} (${branches[0].count})` : advisors[0] ? `most: ${advisors[0].key} (${advisors[0].count})` : "—"}</div>
          </Card>
        </div>

        <Panel title="Rejected claims per month" subtitle="The last 12 months">
          <LineChart series={[{ name: "Rejected claims", color: C.red, points: trend }]} yMax={Math.max(4, ...trend.map((t) => t.value)) * 1.15} unit="" />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {trend.map((t) => (
              <button key={t.month} type="button" onClick={() => setPick({ title: `Rejected in ${t.month}`, rows: all.filter((r) => monthOf(r.date) === t.month) })} className="rounded-md bg-[#f5f5f5] px-2 py-0.5 text-[11px] text-[#6e6e73] hover:bg-[#ececec]">
                {t.month.slice(2)}: <span className="font-bold text-[#1d1d1f]">{t.value}</span>
              </button>
            ))}
          </div>
        </Panel>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {showBranches && <Ranked title="By branch" rows={branches} onPick={(g) => open(`Branch ${g.key}`, (r) => r.branch === g.key)} />}
          <Ranked title="By service advisor" rows={advisors} onPick={(g) => open(`Service advisor ${g.key}`, (r) => (r.advisor ?? "").trim() === g.key)} />
          <Ranked title="By team leader" rows={leaders} onPick={(g) => open(`Team leader ${g.key}`, (r) => (r.teamLeader ?? "").trim() === g.key)} />
          <Ranked title="By vehicle model" rows={models} onPick={(g) => open(`Model ${g.key}`, (r) => (r.model ?? "").trim() === g.key)} />
          <Ranked title="Top labours" rows={labours} onPick={(g) => open(`Labour ${g.key}`, (r) => r.labours.some((l) => l.trim() === g.key))} />
          <Ranked title="Top parts" rows={parts} onPick={(g) => open(`Part ${g.key}`, (r) => r.parts.some((p) => p.trim() === g.key))} />
        </div>
      </div>

      {pick && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onClick={() => setPick(null)} role="dialog" aria-modal="true" aria-label={pick.title}>
          <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3">
              <div>
                <h3 className="font-semibold text-neutral-900">{pick.title}</h3>
                <p className="text-xs text-neutral-500">{pick.rows.length} entr{pick.rows.length === 1 ? "y" : "ies"}</p>
              </div>
              <button type="button" onClick={() => setPick(null)} className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white">
                Close
              </button>
            </div>
            <ul className="min-h-0 flex-1 divide-y divide-neutral-100 overflow-auto">
              {pick.rows.map((r) => (
                <li key={r.id}>
                  <Link href={`${diaryPath}/${r.id}`} className="block px-4 py-2.5 hover:bg-neutral-50">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      <span className="font-semibold text-neutral-900">{r.workOrder}</span>
                      {r.claimNo && <span className="font-mono text-xs text-neutral-600">{r.claimNo}</span>}
                      {showBranches && <Pill tone="muted">{r.branch}</Pill>}
                      {r.repeat && <Pill tone="bad">repeat</Pill>}
                      <span className="ml-auto text-xs text-neutral-500">{fmtDay(r.date)}</span>
                    </div>
                    <p className="line-clamp-2 text-xs text-neutral-600">{r.reason}</p>
                    <p className="text-[11px] text-neutral-500">{[r.advisor && `SA: ${r.advisor}`, r.teamLeader && `TL: ${r.teamLeader}`, r.model].filter(Boolean).join(" · ")}</p>
                  </Link>
                </li>
              ))}
              {pick.rows.length === 0 && <li className="px-4 py-8 text-center text-sm text-neutral-500">No entries.</li>}
            </ul>
          </div>
        </div>
      )}
    </Panel>
  );
}
