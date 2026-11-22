"use client";

import { useMemo, useState } from "react";
import { Panel } from "@/components/dashboard/ui";
import { TipCard, useHoverCard } from "@/components/dashboard/hover";
import { CarLoaderCard } from "@/components/spinner";
import { MONTHS, money, pct } from "@/components/msi/msi-ui";
import type { MsiExtra, MsiReport, SalesRow, DailyRow } from "@/lib/msi/types";

// The Overview tab: the report in plain words and simple pictures - are we on track, which branch is ahead or behind,
// how the month is going day by day, where the money comes from, and which advisors lead or need help.
// Colours: graphite = what was sold, silver = the plan; green / amber / red = on track / close / behind, always with
// an icon and a word next to it (never colour alone).

const INK = "#1d1d1f";
const MUTED = "#6e6e73";
const SOLD = "#3a3a3c";
const PLAN = "#aeaeb2";
const TRACK = "#ececf0";
const STATUS = {
  good: { color: "#248a3d", soft: "#e8f5ec", icon: "✓", word: "On track" },
  warn: { color: "#b45309", soft: "#fdf3e7", icon: "!", word: "Close" },
  bad: { color: "#d70015", soft: "#fdecee", icon: "↓", word: "Behind" },
} as const;
type Status = keyof typeof STATUS;

/** Actual against the plan for the days passed: 100% or more on track, 90% close, below that behind. */
const statusOf = (v: number | null | undefined): Status | null => (v == null ? null : v >= 1 ? "good" : v >= 0.9 ? "warn" : "bad");

/** 5,680,958 -> "5.68M", 42,300 -> "42K". */
export const short = (v: number | null | undefined): string => {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e3) return `${Math.round(v / 1e3)}K`;
  return String(Math.round(v));
};

function StatusTag({ s, label, big = false }: { s: Status | null; label?: string; big?: boolean }) {
  if (!s) return <span className="text-xs text-[#6e6e73]">no target</span>;
  const t = STATUS[s];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap ${big ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs"}`} style={{ backgroundColor: t.soft, color: t.color }}>
      <span aria-hidden="true" className="font-bold">
        {t.icon}
      </span>
      {label ?? t.word}
    </span>
  );
}

const isClosed = (r: SalesRow | undefined) => !r || (r.actual == null && r.mtdTarget == null && !r.forecast);

export function OverviewTab({ report, extra, extraStatus, single }: { report: MsiReport; extra: MsiExtra | null; extraStatus: string; single: boolean }) {
  const m = report.meta;
  const headline = single ? report.sales.find((r) => r.type === "Branch total") : (report.sales.find((r) => r.scope === "KSA" && r.type === "All Branchs") ?? report.sales.find((r) => r.scope === "KSA"));
  const scope = headline?.scope ?? "KSA";
  const expected = m.workingDays ? (m.daysPassed ?? 0) / m.workingDays : null;

  const branches = useMemo(() => {
    const out: { code: string; name: string; row: SalesRow }[] = [];
    for (const r of report.sales) if (r.scope !== "KSA" && r.type === "Branch total" && !isClosed(r)) out.push({ code: r.scope, name: r.scopeName, row: r });
    return out.sort((a, b) => (b.row.mtdPct ?? -1) - (a.row.mtdPct ?? -1));
  }, [report.sales]);

  if (!headline) return <p className="text-sm text-[#6e6e73]">This report has no totals to show.</p>;
  return (
    <div className="space-y-5">
      <Headline row={headline} expected={expected} daysLeft={m.daysRemaining} title={single ? (headline.scopeName ?? "Your branch") : "All branches"} />
      {!single && branches.length > 0 && <BranchRanking branches={branches} />}
      <MonthCurve report={report} extra={extra} extraStatus={extraStatus} scope={scope} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <SalesMix rows={report.sales.filter((r) => r.scope === scope)} />
        <WhoPays rows={report.sales.filter((r) => r.scope === scope)} />
      </div>
      <Advisors report={report} />
    </div>
  );
}

// ---------- 1. Are we on track? ----------

function Headline({ row, expected, daysLeft, title }: { row: SalesRow; expected: number | null; daysLeft: number | null; title: string }) {
  const s = statusOf(row.mtdPct);
  const reached = row.monthPct ?? (row.actual != null && row.monthTarget ? row.actual / row.monthTarget : null);
  const forecastPct = row.forecast != null && row.monthTarget ? row.forecast / row.monthTarget : null;
  const missing = row.monthTarget != null && row.actual != null ? Math.max(0, row.monthTarget - row.actual) : null;
  const perDay = missing != null && daysLeft ? missing / daysLeft : null;
  const gap = row.mtdTarget != null && row.actual != null ? row.actual - row.mtdTarget : null;
  return (
    <section className="grid grid-cols-1 gap-5 rounded-2xl bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.05),0_8px_24px_-12px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.05] lg:grid-cols-[minmax(0,22rem)_1fr] lg:p-6">
      <Gauge reached={reached} expected={expected} forecast={forecastPct} status={s} />
      <div className="flex min-w-0 flex-col justify-center gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[22px] font-bold tracking-tight text-[#1d1d1f]">{title} this month</h2>
          <StatusTag s={s} big label={s === "good" ? "On track" : s === "warn" ? "Slightly behind plan" : s === "bad" ? "Behind plan" : undefined} />
        </div>
        <ul className="space-y-2.5 text-[15px] leading-snug text-[#3a3a3c]">
          <li>
            <b className="text-[#1d1d1f]">Sold so far: SAR {money(row.actual)}</b>. By today the plan expected SAR {money(row.mtdTarget)}
            {gap != null && (
              <>
                {" "}
                - that is <b style={{ color: s ? STATUS[s].color : INK }}>{gap >= 0 ? `SAR ${short(gap)} ahead` : `SAR ${short(-gap)} behind`}</b> ({pct(row.mtdPct)} of plan).
              </>
            )}
          </li>
          <li>
            <b className="text-[#1d1d1f]">If the pace holds</b>, the month closes at SAR {money(row.forecast)} - <b>{pct(forecastPct)}</b> of the month target (SAR {money(row.monthTarget)}).
          </li>
          {missing != null && missing > 0 && perDay != null && (
            <li>
              <b className="text-[#1d1d1f]">To reach the target</b>: SAR {short(missing)} more, about <b>SAR {short(perDay)} every working day</b> for the {daysLeft} working days left.
            </li>
          )}
          {missing === 0 && <li className="font-semibold text-[#248a3d]">The month target is already reached.</li>}
        </ul>
      </div>
    </section>
  );
}

/** Half-circle: how much of the month target is done, with marks for where the plan expects us today and the forecast. */
function Gauge({ reached, expected, forecast, status }: { reached: number | null; expected: number | null; forecast: number | null; status: Status | null }) {
  const MAX = 1.2;
  const R = 92;
  const cx = 120;
  const cy = 112;
  const at = (v: number) => {
    const a = Math.PI * (1 - Math.min(MAX, Math.max(0, v)) / MAX);
    return [cx + R * Math.cos(a), cy - R * Math.sin(a)] as const;
  };
  const arc = (v: number) => {
    const [x, y] = at(v);
    return `M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}`;
  };
  const tick = (v: number, label: string, dy: number) => {
    const a = Math.PI * (1 - Math.min(MAX, v) / MAX);
    const [x1, y1] = [cx + (R - 16) * Math.cos(a), cy - (R - 16) * Math.sin(a)];
    const [x2, y2] = [cx + (R + 16) * Math.cos(a), cy - (R + 16) * Math.sin(a)];
    const [lx, ly] = [cx + (R + 30) * Math.cos(a), cy - (R + 30) * Math.sin(a) + dy];
    return (
      <g>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={INK} strokeWidth={2} strokeLinecap="round" />
        <text x={lx} y={ly} textAnchor={Math.cos(a) > 0.2 ? "start" : Math.cos(a) < -0.2 ? "end" : "middle"} fontSize={11} fontWeight={600} fill={MUTED}>
          {label}
        </text>
      </g>
    );
  };
  const color = status ? STATUS[status].color : SOLD;
  return (
    <figure className="mx-auto w-full max-w-[22rem]">
      <svg viewBox="-30 -26 300 178" className="w-full" role="img" aria-label={`${pct(reached)} of the month target reached; the plan expects ${pct(expected)} by today`}>
        <path d={arc(MAX)} fill="none" stroke={TRACK} strokeWidth={18} strokeLinecap="round" />
        {reached != null && reached > 0 && <path d={arc(reached)} fill="none" stroke={color} strokeWidth={18} strokeLinecap="round" />}
        {/* 100% of the month target */}
        {tick(1, "Target", 0)}
        {expected != null && tick(expected, "Plan today", -4)}
        {forecast != null && Math.abs(forecast - (expected ?? -1)) > 0.04 && Math.abs(forecast - 1) > 0.04 && (
          <circle cx={at(forecast)[0]} cy={at(forecast)[1]} r={5} fill="#fff" stroke={INK} strokeWidth={2} />
        )}
        <text x={cx} y={cy - 18} textAnchor="middle" fontSize={34} fontWeight={700} fill={INK}>
          {pct(reached)}
        </text>
        <text x={cx} y={cy + 2} textAnchor="middle" fontSize={11.5} fill={MUTED}>
          of the month target
        </text>
      </svg>
      <figcaption className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-[#6e6e73]">
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} /> sold so far
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-0.5 bg-[#1d1d1f]" /> plan for today · target
        </span>
        {forecast != null && (
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full border-2 border-[#1d1d1f] bg-white" /> month-end forecast {pct(forecast)}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

// ---------- 2. Branches: who is ahead, who is behind ----------

function BranchRanking({ branches }: { branches: { code: string; name: string; row: SalesRow }[] }) {
  const { bind, layer } = useHoverCard();
  const max = Math.max(1.2, ...branches.map((b) => Math.min(1.6, b.row.mtdPct ?? 0)));
  const x = (v: number) => `${(Math.min(max, Math.max(0, v)) / max) * 100}%`;
  const counts = { good: 0, warn: 0, bad: 0 };
  for (const b of branches) {
    const s = statusOf(b.row.mtdPct);
    if (s) counts[s]++;
  }
  return (
    <Panel
      title="Branches - ahead or behind plan?"
      subtitle="Each bar is what the branch has sold against what the plan expected by today. The line is 100% = exactly on plan. Hover a branch for its numbers."
      action={
        <span className="flex flex-wrap gap-1.5">
          <StatusTag s="good" label={`${counts.good} on track`} />
          <StatusTag s="warn" label={`${counts.warn} close`} />
          <StatusTag s="bad" label={`${counts.bad} behind`} />
        </span>
      }
    >
      <div className="space-y-1">
        <div className="grid grid-cols-[minmax(7rem,11rem)_1fr_4.5rem_6.5rem] items-end gap-3 px-2 pb-1 text-[11px] font-semibold tracking-wide text-[#6e6e73] uppercase max-sm:grid-cols-[7rem_1fr_4rem]">
          <span>Branch</span>
          <span>Sold vs plan for today</span>
          <span className="text-right">vs plan</span>
          <span className="text-right max-sm:hidden">Month end</span>
        </div>
        {branches.map((b) => {
          const s = statusOf(b.row.mtdPct);
          const fc = b.row.forecast != null && b.row.monthTarget ? b.row.forecast / b.row.monthTarget : null;
          return (
            <div
              key={b.code}
              className="grid grid-cols-[minmax(7rem,11rem)_1fr_4.5rem_6.5rem] items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-[#f5f5f7] max-sm:grid-cols-[7rem_1fr_4rem]"
              {...bind(
                <TipCard
                  title={`${b.name} (${b.code})`}
                  rows={[
                    { label: "Sold so far", value: `SAR ${money(b.row.actual)}`, strong: true },
                    { label: "Plan for today", value: `SAR ${money(b.row.mtdTarget)}` },
                    { label: "Month target", value: `SAR ${money(b.row.monthTarget)}` },
                    { label: "Forecast month end", value: `SAR ${money(b.row.forecast)}` },
                  ]}
                  note={s ? `${STATUS[s].word}: ${pct(b.row.mtdPct)} of the plan for today` : undefined}
                />,
              )}
            >
              <span className="truncate text-sm font-medium text-[#1d1d1f]">{b.name}</span>
              <div className="relative h-6">
                <div className="absolute inset-y-1.5 left-0 right-0 rounded-full" style={{ backgroundColor: TRACK }} />
                <div className="absolute inset-y-1.5 left-0 rounded-full" style={{ width: x(b.row.mtdPct ?? 0), backgroundColor: s ? STATUS[s].color : SOLD }} />
                <div className="absolute inset-y-0 w-0.5 bg-[#1d1d1f]" style={{ left: x(1) }} title="100% = on plan" />
              </div>
              <span className="flex justify-end">
                <StatusTag s={s} label={pct(b.row.mtdPct)} />
              </span>
              <span className="text-right text-xs text-[#6e6e73] tabular-nums max-sm:hidden">{pct(fc)} of target</span>
            </div>
          );
        })}
      </div>
      {layer}
    </Panel>
  );
}

// ---------- 3. The month day by day ----------

function MonthCurve({ report, extra, extraStatus, scope }: { report: MsiReport; extra: MsiExtra | null; extraStatus: string; scope: string }) {
  const row = useMemo(() => {
    if (!extra) return null;
    const rows = extra.daily.filter((r) => r.scope === scope);
    return (rows.find((r) => r.type === "All Branchs Total" || r.type === "Branch total" || r.type === "Aftersales Total") ?? rows[0]) as DailyRow | undefined;
  }, [extra, scope]);
  const sales = report.sales.find((r) => r.scope === scope && (r.type === "All Branchs" || r.type === "Branch total")) ?? report.sales.find((r) => r.scope === scope);
  const title = "The month so far - sold against the plan, day by day";
  const subtitle = "The dark line adds up what was sold each day; the light line is where the plan wants us. Dashed: where the month ends if the pace holds.";
  if (!extra)
    return (
      <Panel title={title} subtitle={subtitle}>
        {extraStatus === "missing" ? <p className="text-sm text-[#6e6e73]">The day-by-day sheet is kept for the newest report only.</p> : extraStatus === "failed" ? <p className="text-sm text-[#6e6e73]">Could not load the day-by-day sheet.</p> : <CarLoaderCard label="Loading the days…" />}
      </Panel>
    );
  if (!row) return null;
  return (
    <Panel title={title} subtitle={subtitle} eyebrow={`${MONTHS[report.meta.month - 1]} ${report.meta.year}`}>
      <Curve row={row} report={report} monthTarget={sales?.monthTarget ?? row.monthTarget} forecast={sales?.forecast ?? null} />
    </Panel>
  );
}

function Curve({ row, report, monthTarget, forecast }: { row: DailyRow; report: MsiReport; monthTarget: number | null; forecast: number | null }) {
  const { year, month } = report.meta;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const runDay = Math.min(lastDay, Number(report.reportDate.slice(8, 10)));
  const isFriday = (d: number) => new Date(Date.UTC(year, month - 1, d)).getUTCDay() === 5;
  const working = Array.from({ length: lastDay }, (_, i) => !isFriday(i + 1));
  const totalWorking = working.filter(Boolean).length || 1;
  const pts = Array.from({ length: lastDay }, (_, i) => {
    const d = i + 1;
    const wd = working.slice(0, d).filter(Boolean).length;
    const sold = d <= runDay ? row.days.slice(0, d).reduce<number>((s, v) => s + (v ?? 0), 0) : null;
    return { d, sold, day: d <= runDay ? (row.days[i] ?? 0) : null, plan: (monthTarget ?? 0) * (wd / totalWorking) };
  });
  const top = Math.max(monthTarget ?? 0, forecast ?? 0, ...pts.map((p) => p.sold ?? 0)) * 1.08 || 1;
  const W = 760;
  const H = 280;
  const L = 56;
  const B = 28;
  const T = 12;
  const R = 70;
  const xs = (d: number) => L + ((d - 1) / Math.max(1, lastDay - 1)) * (W - L - R);
  const ys = (v: number) => T + (1 - v / top) * (H - T - B);
  const line = (vals: { d: number; v: number }[]) => vals.map((p, i) => `${i ? "L" : "M"}${xs(p.d).toFixed(1)},${ys(p.v).toFixed(1)}`).join(" ");
  const soldPts = pts.filter((p) => p.sold != null).map((p) => ({ d: p.d, v: p.sold! }));
  const planPts = pts.map((p) => ({ d: p.d, v: p.plan }));
  const nowSold = soldPts.at(-1);
  const grid = [0.25, 0.5, 0.75, 1].map((f) => top * f);
  const [hover, setHover] = useState<number | null>(null);
  const hp = hover != null ? pts[hover - 1] : null;
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Cumulative sales against the plan this month"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const d = Math.round(((px - L) / (W - L - R)) * (lastDay - 1)) + 1;
          setHover(d >= 1 && d <= lastDay ? d : null);
        }}
      >
        {grid.map((g) => (
          <g key={g}>
            <line x1={L} x2={W - R} y1={ys(g)} y2={ys(g)} stroke="#f0f0f2" />
            <text x={L - 8} y={ys(g) + 4} textAnchor="end" fontSize={11} fill={MUTED}>
              {short(g)}
            </text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={ys(0)} y2={ys(0)} stroke="#d2d2d7" />
        {[1, 5, 10, 15, 20, 25, lastDay].map((d) => (
          <text key={d} x={xs(d)} y={H - 8} textAnchor="middle" fontSize={11} fill={MUTED}>
            {d}
          </text>
        ))}
        {monthTarget != null && (
          <>
            <line x1={L} x2={W - R} y1={ys(monthTarget)} y2={ys(monthTarget)} stroke={PLAN} strokeDasharray="2 4" />
            <text x={W - R + 6} y={ys(monthTarget) + 4} fontSize={11} fontWeight={600} fill={MUTED}>
              Target
            </text>
          </>
        )}
        <path d={line(planPts)} fill="none" stroke={PLAN} strokeWidth={2} />
        <text x={W - R + 6} y={ys(planPts.at(-1)!.v) + 16} fontSize={11} fill={MUTED}>
          Plan
        </text>
        {nowSold && forecast != null && (
          <>
            <path d={`M${xs(nowSold.d)},${ys(nowSold.v)} L${xs(lastDay)},${ys(forecast)}`} fill="none" stroke={SOLD} strokeWidth={2} strokeDasharray="5 5" />
            <circle cx={xs(lastDay)} cy={ys(forecast)} r={4.5} fill="#fff" stroke={SOLD} strokeWidth={2} />
            <text x={W - R + 6} y={ys(forecast) - 6} fontSize={11} fontWeight={600} fill={INK}>
              {short(forecast)}
            </text>
          </>
        )}
        <path d={line(soldPts)} fill="none" stroke={SOLD} strokeWidth={2.5} strokeLinejoin="round" />
        {nowSold && (
          <>
            <circle cx={xs(nowSold.d)} cy={ys(nowSold.v)} r={5} fill={SOLD} stroke="#fff" strokeWidth={2} />
            <text x={xs(nowSold.d)} y={ys(nowSold.v) - 12} textAnchor="middle" fontSize={12} fontWeight={700} fill={INK}>
              Today {short(nowSold.v)}
            </text>
          </>
        )}
        {hp && (
          <line x1={xs(hp.d)} x2={xs(hp.d)} y1={T} y2={H - B} stroke="#1d1d1f" strokeOpacity={0.25} />
        )}
      </svg>
      {hp && (
        <div className="pointer-events-none absolute top-2 rounded-lg bg-[#1d1d1f]/95 px-3 py-2 text-xs text-white shadow-xl" style={{ left: `min(calc(${(xs(hp.d) / W) * 100}% + 10px), calc(100% - 13rem))` }}>
          <TipCard
            title={`${hp.d} ${MONTHS[month - 1]}${isFriday(hp.d) ? " (Friday)" : ""}`}
            rows={[
              ...(hp.day != null ? [{ label: "Sold that day", value: `SAR ${money(hp.day)}` }] : []),
              ...(hp.sold != null ? [{ label: "Sold up to then", value: `SAR ${money(hp.sold)}`, color: SOLD, strong: true }] : []),
              { label: "Plan up to then", value: `SAR ${money(hp.plan)}`, color: PLAN },
            ]}
            note={hp.sold == null ? "Still to come" : undefined}
          />
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-[#6e6e73]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-5 bg-[#3a3a3c]" /> Sold (adding up)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-5 bg-[#aeaeb2]" /> Plan
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-5 border-t-2 border-dashed border-[#3a3a3c]" /> Forecast to month end
        </span>
      </div>
    </div>
  );
}

// ---------- 4. Where the money comes from / who pays ----------

function Bars({ items, note }: { items: { label: string; value: number; ofPlan: number | null }[]; note: string }) {
  const { bind, layer } = useHoverCard();
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="space-y-2.5">
      {items.map((i) => {
        const s = statusOf(i.ofPlan);
        return (
          <div key={i.label} className="space-y-1 rounded-lg px-1 py-0.5 hover:bg-[#f5f5f7]" {...bind(<TipCard title={i.label} rows={[{ label: "Sold so far", value: `SAR ${money(i.value)}`, strong: true }, { label: "Share", value: pct(i.value / total) }, { label: "vs plan for today", value: pct(i.ofPlan) }]} />)}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-[#1d1d1f]">{i.label}</span>
              <span className="flex items-center gap-2 tabular-nums">
                <span className="text-[#1d1d1f]">SAR {short(i.value)}</span>
                <span className="w-9 text-right text-xs text-[#6e6e73]">{pct(i.value / total)}</span>
                <StatusTag s={s} label={pct(i.ofPlan)} />
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full" style={{ backgroundColor: TRACK }}>
              <div className="h-full rounded-full" style={{ width: `${(i.value / max) * 100}%`, backgroundColor: SOLD }} />
            </div>
          </div>
        );
      })}
      <p className="pt-1 text-xs text-[#6e6e73]">{note}</p>
      {layer}
    </div>
  );
}

function SalesMix({ rows }: { rows: SalesRow[] }) {
  const pick = (type: string, label: string) => {
    const r = rows.find((x) => x.part === "Breakdown" && x.type === type && x.channel === "Total");
    return r?.actual ? { label, value: r.actual, ofPlan: r.mtdPct } : null;
  };
  const items = [pick("Labor", "Labor"), pick("Workshop Parts", "Workshop parts"), pick("Lubes", "Oil & lubricants"), pick("Parts Counter", "Parts counter"), pick("Consumables", "Consumables"), pick("Sublet", "Sublet")]
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.value - a.value);
  if (!items.length) return null;
  return (
    <Panel title="Where the money comes from" subtitle="What each kind of sale brought in so far, its share, and how it stands against its own plan">
      <Bars items={items} note="The coloured tag is each line against its own plan for today." />
    </Panel>
  );
}

function WhoPays({ rows }: { rows: SalesRow[] }) {
  const items = ["Retail", "Warranty", "Internal"]
    .map((ch) => {
      const r = rows.find((x) => x.type === "Service Total" && x.channel === ch) ?? rows.find((x) => x.part === "Breakdown" && x.type === "Labor" && x.channel === ch);
      return r?.actual ? { label: ch === "Retail" ? "Customers (retail)" : ch === "Warranty" ? "Warranty (MG pays)" : "Internal (company cars)", value: r.actual, ofPlan: r.mtdPct } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  if (!items.length) return null;
  return (
    <Panel title="Who pays for the workshop" subtitle="Workshop service sales by who pays, against each one's plan for today">
      <Bars items={items} note="Service total: labor, consumables and sublet." />
    </Panel>
  );
}

// ---------- 5. Advisors ----------

function Advisors({ report }: { report: MsiReport }) {
  const list = report.advisors.filter((a) => a.kind === "advisor" && a.pctMtd != null && (a.target.total ?? 0) > 0);
  const { bind, layer } = useHoverCard();
  if (list.length < 2) return null;
  const sorted = [...list].sort((a, b) => (b.pctMtd ?? 0) - (a.pctMtd ?? 0));
  const n = Math.min(5, Math.floor(sorted.length / 2));
  const groups = [
    { title: "Leading", list: sorted.slice(0, n) },
    { title: "Need support", list: sorted.slice(-n).reverse() },
  ];
  const max = Math.max(1.2, ...sorted.map((a) => Math.min(1.6, a.pctMtd ?? 0)));
  return (
    <Panel title="Service advisors" subtitle={`Against their plan for today - the top ${n} and the ${n} who need the most support. The full list is in the Advisors tab.`}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {groups.map((g) => (
          <div key={g.title} className="space-y-1.5">
            <p className="text-[13px] font-semibold text-[#1d1d1f]">{g.title}</p>
            {g.list.map((a) => {
              const s = statusOf(a.pctMtd);
              return (
                <div
                  key={`${a.branch}|${a.name}`}
                  className="grid grid-cols-[minmax(0,1fr)_7rem_4.5rem] items-center gap-3 rounded-lg px-1.5 py-1 hover:bg-[#f5f5f7]"
                  {...bind(<TipCard title={a.name} rows={[{ label: "Branch", value: a.branch }, { label: "Sold so far", value: `SAR ${money(a.achievement.total)}`, strong: true }, { label: "Month target", value: `SAR ${money(a.target.total)}` }, { label: "vs plan for today", value: pct(a.pctMtd) }]} />)}
                >
                  <span className="min-w-0 truncate text-sm text-[#1d1d1f]">
                    {a.name} <span className="text-xs text-[#6e6e73]">{a.branch}</span>
                  </span>
                  <div className="relative h-2.5 rounded-full" style={{ backgroundColor: TRACK }}>
                    <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(Math.min(max, a.pctMtd ?? 0) / max) * 100}%`, backgroundColor: s ? STATUS[s].color : SOLD }} />
                    <div className="absolute -inset-y-1 w-0.5 bg-[#1d1d1f]" style={{ left: `${(1 / max) * 100}%` }} />
                  </div>
                  <span className="flex justify-end">
                    <StatusTag s={s} label={pct(a.pctMtd)} />
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {layer}
    </Panel>
  );
}
