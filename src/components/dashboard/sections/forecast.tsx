"use client";

import { use } from "react";
import type { SettlementForecast } from "@/lib/dashboard/forecast";
import { C, monthShort } from "@/components/dashboard/charts";
import { TipCard, useHoverCard } from "@/components/dashboard/hover";
import { Label, Panel, Pill, fmtCompact, fmtInt, fmtMoney } from "@/components/dashboard/ui";

/** Officer-only: gross Claim TOL. per monthly settlement, last 18 months + next 3 forecast. */
export function ForecastPanel({ forecast, currency }: { forecast: Promise<SettlementForecast>; currency: string }) {
  const f = use(forecast);
  const { bind, layer } = useHoverCard();
  const hist = f.history.slice(-18);
  if (hist.length < 4 || f.forecast.length === 0) return null;

  const all = [
    ...hist.map((p) => ({ month: p.month, value: p.gross, low: null as number | null, high: null as number | null, kind: "actual" as const, p })),
    ...f.forecast.map((p) => ({ month: p.month, value: p.gross, low: p.low, high: p.high, kind: "forecast" as const, p: null })),
  ];
  const W = 760;
  const H = 260;
  const pad = { top: 16, right: 16, bottom: 30, left: 52 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const max = Math.max(...all.map((a) => a.high ?? a.value)) * 1.08;
  const x = (i: number) => pad.left + (i / (all.length - 1)) * innerW;
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const lastActual = hist.length - 1;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const avg12 = f.history.slice(-12).reduce((s, p) => s + p.gross, 0) / Math.min(12, f.history.length);
  const prevOf = (k: number) => (k === 0 ? hist[lastActual].gross : f.forecast[k - 1].gross);
  const pct = (v: number, base: number) => (base ? `${v >= base ? "+" : ""}${(((v - base) / base) * 100).toFixed(1)}%` : "—");

  const actualPath = hist.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.gross).toFixed(1)}`).join(" ");
  const fcPath = [`M${x(lastActual).toFixed(1)},${y(hist[lastActual].gross).toFixed(1)}`, ...f.forecast.map((p, k) => `L${x(lastActual + 1 + k).toFixed(1)},${y(p.gross).toFixed(1)}`)].join(" ");
  const band = [
    `M${x(lastActual).toFixed(1)},${y(hist[lastActual].gross).toFixed(1)}`,
    ...f.forecast.map((p, k) => `L${x(lastActual + 1 + k).toFixed(1)},${y(p.high).toFixed(1)}`),
    ...[...f.forecast].reverse().map((p, k) => `L${x(lastActual + f.forecast.length - k).toFixed(1)},${y(p.low).toFixed(1)}`),
    "Z",
  ].join(" ");

  return (
    <Panel
      eyebrow="Forecast"
      title="Gross warranty claims - next 3 months"
      subtitle={`Claim TOL. per monthly SAIC settlement (${currency}) · ${f.method}`}
      action={<Pill tone="blue">Officer only</Pill>}
    >
      {layer}
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {f.forecast.map((p, k) => (
          <div key={p.month} className="rounded-lg bg-[#f5f5f5] p-3" {...bind(<TipCard title={`${monthShort(p.month)} (forecast)`} rows={[{ label: "Expected", value: fmtMoney(p.gross), strong: true }, { label: "Likely range", value: `${fmtMoney(p.low)} – ${fmtMoney(p.high)}` }, { label: "vs previous month", value: pct(p.gross, prevOf(k)) }, { label: "vs 12-mo average", value: pct(p.gross, avg12) }]} />)}>
            <Label>Month {k + 1} · {monthShort(p.month)}</Label>
            <div className="font-display text-xl font-bold text-[#2d2d2d]">{fmtMoney(p.gross)}</div>
            <div className="text-[11px] text-[#575e70]">
              range {fmtCompact(p.low)} – {fmtCompact(p.high)} · {pct(p.gross, prevOf(k))} vs {k === 0 ? "last settled" : "prev. month"}
            </div>
          </div>
        ))}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke={C.grid} strokeDasharray={t ? "3 4" : undefined} />
            <text x={pad.left - 6} y={y(t) + 4} textAnchor="end" className="fill-neutral-400 text-[11px]">
              {fmtCompact(t)}
            </text>
          </g>
        ))}
        <rect x={x(lastActual)} y={pad.top} width={W - pad.right - x(lastActual)} height={innerH} fill={C.blueLight} opacity={0.05} />
        <path d={band} fill={C.blueLight} opacity={0.15} />
        <path d={actualPath} fill="none" stroke={C.red} strokeWidth={2.5} strokeLinejoin="round" />
        <path d={fcPath} fill="none" stroke={C.blueLight} strokeWidth={2.5} strokeDasharray="6 5" />
        {all.map((a, i) => (
          <g key={a.month}>
            <circle cx={x(i)} cy={y(a.value)} r={a.kind === "forecast" ? 4.5 : 3.5} fill="white" stroke={a.kind === "forecast" ? C.blueLight : C.red} strokeWidth={2} />
            {a.kind === "forecast" && (
              <text x={x(i)} y={y(a.value) - 9} textAnchor={i === all.length - 1 ? "end" : "middle"} className="fill-[#2d2d2d] text-[11px] font-bold">
                {fmtCompact(a.value)}
              </text>
            )}
            {(i % 3 === 0 || i === all.length - 1 || i === lastActual) && (
              <text x={x(i)} y={H - 10} textAnchor="middle" className={`text-[11px] ${a.kind === "forecast" ? "fill-[#2d2d2d] font-bold" : "fill-neutral-500"}`}>
                {monthShort(a.month)}
              </text>
            )}
            {/* Wide invisible hit area per month for the hover card. */}
            <rect
              x={x(i) - innerW / all.length / 2}
              y={pad.top}
              width={innerW / all.length}
              height={innerH}
              fill="transparent"
              {...bind(
                a.kind === "actual" && a.p ? (
                  <TipCard
                    title={`${monthShort(a.month)} · settled`}
                    rows={[
                      { label: "Gross claimed", value: fmtMoney(a.p.gross), color: C.red, strong: true },
                      { label: "Adjusted (paid)", value: fmtMoney(a.p.adjusted) },
                      { label: "Detected", value: fmtMoney(a.p.adjusted - a.p.gross) },
                      { label: "Claims", value: fmtInt(a.p.claims) },
                    ]}
                    note={a.p.order}
                  />
                ) : (
                  <TipCard
                    title={`${monthShort(a.month)} · forecast`}
                    rows={[
                      { label: "Expected", value: fmtMoney(a.value), color: C.blueLight, strong: true },
                      { label: "Likely range", value: `${fmtMoney(a.low ?? 0)} – ${fmtMoney(a.high ?? 0)}` },
                    ]}
                    note="80% range - wider further out"
                  />
                )
              )}
            />
          </g>
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-[#575e70]">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-[#c4121a]" /> Settled (actual)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 border-t-2 border-dashed border-[#8a8d91]" /> Forecast
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-4 rounded-sm bg-[#8a8d91]/20" /> Likely range
        </span>
      </div>
    </Panel>
  );
}

export function ForecastSkeleton() {
  return <div className="h-80 animate-pulse rounded-xl bg-white ring-1 ring-[#dce9ff]/60" />;
}
