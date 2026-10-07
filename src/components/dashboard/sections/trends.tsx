"use client";

import { Fragment, use, useMemo, useState } from "react";
import type { RepeatRow, TrendData, TrendItem } from "@/lib/dashboard/trends";
import type { DashboardData } from "@/lib/dashboard/kpis";
import { C, monthShort } from "@/components/dashboard/charts";
import { Card, Icon, Label, Metric, Panel, Pill, fmtDate, fmtInt, fmtMoney, fmtNum } from "@/components/dashboard/ui";

const SPIKES = [
  { label: "≥ 1.5×", value: 1.5 },
  { label: "≥ 2×", value: 2 },
  { label: "≥ 3×", value: 3 },
];
const MIN_CLAIMS = [2, 3, 5, 10];

const selectClass =
  "rounded-lg border-0 bg-[#eff4ff] px-2.5 py-1.5 text-xs font-semibold text-[#0b1c30] ring-1 ring-[#dce9ff] focus:ring-2 focus:ring-[#c4121a]/30 focus:outline-none";

function isFlagged(i: TrendItem, spike: number, minClaims: number, includeNew: boolean) {
  if (i.current < minClaims) return false;
  if (i.isNew) return includeNew;
  return (i.ratio ?? 0) >= spike;
}

/** Monthly bars: baseline months grey, selected period red. */
function Spark({ item, currentMonths }: { item: TrendItem; currentMonths: string[] }) {
  const max = Math.max(...item.monthly.map((m) => m.count), 1);
  const cur = new Set(currentMonths);
  return (
    <div className="flex h-8 w-36 items-end gap-0.5">
      {item.monthly.map((m) => (
        <div
          key={m.month}
          className="min-w-1 flex-1 rounded-t-sm"
          style={{ height: `${Math.max((m.count / max) * 100, m.count ? 8 : 3)}%`, backgroundColor: cur.has(m.month) ? C.red : m.count ? C.slateSoft : "#e5eeff" }}
          title={`${monthShort(m.month)}: ${m.count} claims`}
        />
      ))}
    </div>
  );
}

function TrendTable({
  items,
  kind,
  data,
  labels,
}: {
  items: TrendItem[];
  kind: "labor" | "parts";
  data: TrendData;
  labels: DashboardData["labels"];
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (items.length === 0)
    return <p className="py-10 text-center text-sm text-[#575e70]">Nothing unusual with these settings. Try a lower spike or minimum.</p>;

  const name = (i: TrendItem) => (kind === "labor" ? (labels.labor[i.key] ?? i.key) : i.key);
  const code = (i: TrendItem) => (kind === "labor" ? (labels.labor[i.key] ? i.key : null) : (labels.partNo[i.key] ?? null));
  const series = (model: string) => labels.series[model] ?? model;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-[#eff4ff] text-[11px] font-bold tracking-wider text-[#575e70] uppercase">
          <tr>
            <th className="px-3 py-2.5">{kind === "labor" ? "Labor operation" : "Main part"}</th>
            <th className="px-3 py-2.5">
              Trend <span className="font-normal normal-case">({data.baselineMonths.length} mo baseline → period)</span>
            </th>
            <th className="px-3 py-2.5 text-right">Claims</th>
            <th className="px-3 py-2.5 text-right">Per month</th>
            <th className="px-3 py-2.5">Signal</th>
            <th className="px-3 py-2.5">Top models</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#e5eeff]">
          {items.map((i) => {
            const expanded = open === i.key;
            return (
              <Fragment key={i.key}>
                <tr
                  className={`cursor-pointer transition-colors ${expanded ? "bg-[#ffdad6]/30" : "hover:bg-[#eff4ff]/60"}`}
                  onClick={() => setOpen(expanded ? null : i.key)}
                >
                  <td className="max-w-80 px-3 py-2.5">
                    <div className="truncate font-semibold text-[#0b1c30]" title={name(i)}>
                      {name(i)}
                    </div>
                    {code(i) && <div className="font-mono text-[11px] text-[#575e70]">{code(i)}</div>}
                  </td>
                  <td className="px-3 py-2.5">
                    <Spark item={i} currentMonths={data.currentMonths} />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="font-display font-bold">{fmtInt(i.current)}</div>
                    <div className="text-[11px] text-[#575e70]">{fmtMoney(i.currentAmount)}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs whitespace-nowrap">
                    <span className="text-[#575e70]">{fmtNum(i.baselinePerMonth)}</span> → <strong className="text-[#9a000d]">{fmtNum(i.currentPerMonth)}</strong>
                  </td>
                  <td className="px-3 py-2.5">
                    {i.isNew ? <Pill tone="bad">NEW</Pill> : <Pill tone={(i.ratio ?? 0) >= 3 ? "bad" : "warn"}>× {fmtNum(i.ratio)}</Pill>}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    <div className="flex flex-wrap gap-1">
                      {i.models.slice(0, 2).map((m) => (
                        <Pill key={m.model} tone="muted">
                          {series(m.model)} · {m.count}
                        </Pill>
                      ))}
                    </div>
                  </td>
                </tr>
                {expanded && (
                  <tr className="bg-[#ffdad6]/15">
                    <td colSpan={6} className="px-3 py-3">
                      <div className="grid gap-4 md:grid-cols-3">
                        <div>
                          <Label>Monthly claims</Label>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {i.monthly.map((m) => (
                              <span
                                key={m.month}
                                className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                                  data.currentMonths.includes(m.month) ? "bg-[#c4121a] text-white" : "bg-[#eff4ff] text-[#575e70]"
                                }`}
                              >
                                {monthShort(m.month)}: {m.count}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <Label>Models in period</Label>
                          <div className="mt-1 space-y-0.5 text-xs">
                            {i.models.map((m) => (
                              <div key={m.model} className="flex justify-between gap-2">
                                <span>{series(m.model)} <span className="text-[#575e70]">({m.model})</span></span>
                                <strong>{m.count}</strong>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <Label>Branches in period</Label>
                          <div className="mt-1 space-y-0.5 text-xs">
                            {i.branches.map((b) => (
                              <div key={b.name} className="flex justify-between gap-2">
                                <span>{b.name}</span>
                                <strong>{b.count}</strong>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                      <p className="mt-3 text-[11px] text-[#575e70]">
                        {i.isNew
                          ? `Not seen in the ${data.baselineMonths.length} months before this period.`
                          : `${fmtInt(i.baseline)} claims in the ${data.baselineMonths.length} baseline months (${fmtNum(i.baselinePerMonth)}/month) vs ${fmtNum(i.currentPerMonth)}/month now.`}{" "}
                        Spread across several branches or concentrated on one model points to a possible new concern for the OEM.
                      </p>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RepeatTable({ rows, labels }: { rows: RepeatRow[]; labels: DashboardData["labels"] }) {
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-[#575e70]">No repeated repairs in this period.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-[#eff4ff] text-[11px] font-bold tracking-wider text-[#575e70] uppercase">
          <tr>
            <th className="px-3 py-2.5">Type</th>
            <th className="px-3 py-2.5">VIN / model</th>
            <th className="px-3 py-2.5">Labor operation</th>
            <th className="px-3 py-2.5">First claim</th>
            <th className="px-3 py-2.5">Repeat claim</th>
            <th className="px-3 py-2.5 text-right">Days / km apart</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#e5eeff]">
          {rows.map((r) => (
            <tr key={`${r.first.claimNumber}-${r.second.claimNumber}`} className="hover:bg-[#eff4ff]/60">
              <td className="px-3 py-2.5">
                {r.kind === "duplicate" ? <Pill tone="bad">Possible duplicate</Pill> : <Pill tone="warn">Repeat visit</Pill>}
                <div className="mt-0.5 text-[11px] text-[#575e70]">{r.branch}</div>
              </td>
              <td className="px-3 py-2.5">
                <div className="font-mono text-xs font-semibold">{r.vin}</div>
                <div className="text-[11px] text-[#575e70]">{r.model ? (labels.series[r.model] ?? r.model) : "—"}</div>
              </td>
              <td className="max-w-72 px-3 py-2.5">
                <div className="truncate font-semibold" title={labels.labor[r.laborCode]}>
                  {labels.labor[r.laborCode] ?? r.laborCode}
                </div>
                <div className="truncate text-[11px] text-[#575e70]">
                  {r.laborCode}
                  {r.partName && ` · ${r.partName}`}
                </div>
              </td>
              {[r.first, r.second].map((c, idx) => (
                <td key={idx} className="px-3 py-2.5 text-xs whitespace-nowrap">
                  <div className="font-semibold text-[#0b1c30]">{c.workOrderNo ?? "—"}</div>
                  <div className="text-[#575e70]">
                    {fmtDate(c.date)}
                    {c.mileage != null && ` · ${fmtInt(Number(c.mileage))} km`}
                  </div>
                  <div className="text-[10px] text-[#575e70]">{c.claimNumber}</div>
                </td>
              ))}
              <td className="px-3 py-2.5 text-right text-xs whitespace-nowrap">
                <div className={`font-bold ${(r.daysBetween ?? 99) <= 30 ? "text-[#9a000d]" : ""}`}>{r.daysBetween ?? "—"} days</div>
                <div className="text-[#575e70]">{r.kmBetween != null ? `${fmtInt(r.kmBetween)} km` : "—"}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TrendsSection({ trends, data }: { trends: Promise<TrendData>; data: DashboardData }) {
  const t = use(trends);
  const [view, setView] = useState<"labor" | "parts">("labor");
  const [spike, setSpike] = useState(2);
  const [minClaims, setMinClaims] = useState(3);
  const [includeNew, setIncludeNew] = useState(true);
  const [query, setQuery] = useState("");
  const [repeatKind, setRepeatKind] = useState<"all" | "duplicate" | "repeat">("all");

  const labels = data.labels;
  const flaggedLabor = useMemo(() => t.labor.filter((i) => isFlagged(i, spike, minClaims, includeNew)), [t.labor, spike, minClaims, includeNew]);
  const flaggedParts = useMemo(() => t.parts.filter((i) => isFlagged(i, spike, minClaims, includeNew)), [t.parts, spike, minClaims, includeNew]);

  const q = query.trim().toLowerCase();
  const matches = (i: TrendItem) =>
    !q ||
    i.key.toLowerCase().includes(q) ||
    (labels.labor[i.key] ?? "").toLowerCase().includes(q) ||
    (labels.partNo[i.key] ?? "").toLowerCase().includes(q);
  const list = (view === "labor" ? flaggedLabor : flaggedParts)
    .filter(matches)
    .sort((a, b) => (a.isNew === b.isNew ? (b.ratio ?? 0) * b.current - (a.ratio ?? 0) * a.current : a.isNew ? -1 : 1));

  const duplicates = t.repeats.filter((r) => r.kind === "duplicate");
  const repeatVisits = t.repeats.filter((r) => r.kind === "repeat");
  const repeatRows = repeatKind === "all" ? t.repeats : repeatKind === "duplicate" ? duplicates : repeatVisits;
  const periodLabel = `${monthShort(t.baselineMonths[0])} – ${monthShort(t.baselineMonths[t.baselineMonths.length - 1])}`;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card accent={C.red}>
          <Label>Labor codes trending up</Label>
          <Metric value={fmtInt(flaggedLabor.length)} unit={`${flaggedLabor.filter((i) => i.isNew).length} new`} tone="red" />
          <div className="text-[11px] text-[#575e70]">vs own average {periodLabel}</div>
        </Card>
        <Card accent={C.primary}>
          <Label>Parts trending up</Label>
          <Metric value={fmtInt(flaggedParts.length)} unit={`${flaggedParts.filter((i) => i.isNew).length} new`} tone="red" />
          <div className="text-[11px] text-[#575e70]">by main part, same comparison</div>
        </Card>
        <Card accent={C.amber}>
          <Label>Repeat repairs</Label>
          <Metric value={fmtInt(repeatVisits.length)} unit="VIN came back" />
          <div className="text-[11px] text-[#575e70]">Same VIN + labor code, different job card</div>
        </Card>
        <Card accent={C.blue}>
          <Label>Possible duplicate claims</Label>
          <Metric value={fmtInt(duplicates.length)} unit="to check" tone={duplicates.length ? "red" : undefined} />
          <div className="text-[11px] text-[#575e70]">Same VIN + labor code on the same job card</div>
        </Card>
      </div>

      <Panel
        eyebrow="Early warning"
        title="Unusual labor & part trends"
        subtitle={`Claims per month in the selected period vs each code's own average over ${periodLabel}. Click a row for the breakdown.`}
        action={
          <div className="flex rounded-lg bg-[#eff4ff] p-0.5">
            {(["labor", "parts"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`rounded-md px-3 py-1 text-xs font-bold transition ${view === v ? "bg-white text-[#0b1c30] shadow-sm" : "text-[#575e70] hover:text-[#0b1c30]"}`}
              >
                {v === "labor" ? `Labor codes (${flaggedLabor.length})` : `Part numbers (${flaggedParts.length})`}
              </button>
            ))}
          </div>
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-[#f8f9ff] p-2.5 ring-1 ring-[#dce9ff]/60">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[#575e70]">
            Spike
            <select value={spike} onChange={(e) => setSpike(Number(e.target.value))} className={selectClass}>
              {SPIKES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label} usual
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[#575e70]">
            Min claims
            <select value={minClaims} onChange={(e) => setMinClaims(Number(e.target.value))} className={selectClass}>
              {MIN_CLAIMS.map((n) => (
                <option key={n} value={n}>
                  {n}+
                </option>
              ))}
            </select>
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-[#575e70]">
            <input type="checkbox" checked={includeNew} onChange={(e) => setIncludeNew(e.target.checked)} className="accent-[#c4121a]" />
            Include codes not seen before
          </label>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={view === "labor" ? "Search labor code or name…" : "Search part name or number…"}
            className={`${selectClass} ml-auto w-56 font-medium`}
          />
        </div>
        <TrendTable items={list} kind={view} data={t} labels={labels} />
      </Panel>

      <Panel
        eyebrow="Investigate"
        title="Repeat & duplicate repairs"
        subtitle="Same VIN repaired again with the same labor code - the later claim falls in the selected period"
        action={
          <div className="flex rounded-lg bg-[#eff4ff] p-0.5">
            {(
              [
                ["all", `All (${t.repeats.length})`],
                ["duplicate", `Possible duplicates (${duplicates.length})`],
                ["repeat", `Repeat visits (${repeatVisits.length})`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setRepeatKind(k)}
                className={`rounded-md px-3 py-1 text-xs font-bold transition ${repeatKind === k ? "bg-white text-[#0b1c30] shadow-sm" : "text-[#575e70] hover:text-[#0b1c30]"}`}
              >
                {label}
              </button>
            ))}
          </div>
        }
      >
        <RepeatTable rows={repeatRows} labels={labels} />
      </Panel>
    </div>
  );
}

export function TrendsSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-white ring-1 ring-[#dce9ff]/60" />
        ))}
      </div>
      <div className="flex h-96 animate-pulse items-center justify-center rounded-xl bg-white text-sm text-[#575e70] ring-1 ring-[#dce9ff]/60">
        <span className="flex items-center gap-2">
          <Icon.timer size={16} /> Comparing this period with the previous 6 months…
        </span>
      </div>
    </div>
  );
}
