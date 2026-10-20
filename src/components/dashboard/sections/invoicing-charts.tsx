"use client";

import { useState } from "react";

/** MG brand colours: labor in MG red, parts in MG black, the total in MG silver. */
export const INV = { labor: "#c4121a", parts: "#2d2d2d", total: "#8a8d91", grid: "#e5e5e5", soft: "#fdf2f2" };
export const INV_SERIES = ["#c4121a", "#2d2d2d", "#8a8d91", "#7a0010", "#e2747b", "#55585c", "#b9bcc0", "#d97706", "#0f766e"];

const compact = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)}K` : String(Math.round(v)));
const money = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });

export type MoneySeries = { name: string; color: string; values: number[]; dashed?: boolean };

/**
 * Money line chart: hover a point for every series' value, click it (e.g. to open that day's lines), and tap a
 * legend entry to hide / show a series.
 */
export function MoneyLine({ labels, series, onPick, pickHint }: { labels: { key: string; short: string; long: string }[]; series: MoneySeries[]; onPick?: (i: number) => void; pickHint?: string }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  if (!labels.length) return <p className="py-10 text-center text-sm text-slate-500">No data for these filters.</p>;
  const W = 760;
  const H = 240;
  const pad = { top: 14, right: 16, bottom: 26, left: 48 };
  const iw = W - pad.left - pad.right;
  const ih = H - pad.top - pad.bottom;
  const visible = series.filter((s) => !hidden.has(s.name));
  const max = Math.max(1, ...visible.flatMap((s) => s.values)) * 1.1;
  const x = (i: number) => pad.left + (labels.length === 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
  const y = (v: number) => pad.top + ih - (Math.max(v, 0) / max) * ih;
  const every = Math.ceil(labels.length / 12);

  return (
    <div className="space-y-2">
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className={`h-auto w-full select-none ${onPick ? "cursor-pointer" : ""}`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - r.left) / r.width) * W;
            const i = labels.length === 1 ? 0 : Math.round(((px - pad.left) / iw) * (labels.length - 1));
            setHover(Math.min(Math.max(i, 0), labels.length - 1));
          }}
          onClick={() => hover != null && onPick?.(hover)}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={W - pad.right} y1={y(t * max)} y2={y(t * max)} stroke={INV.grid} strokeDasharray={t ? "3 4" : undefined} />
              <text x={pad.left - 6} y={y(t * max) + 4} textAnchor="end" className="fill-slate-400 text-[10px]">
                {compact(t * max)}
              </text>
            </g>
          ))}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + ih} stroke="#94a3b8" strokeDasharray="2 3" />}
          {visible.map((s) => (
            <g key={s.name}>
              <path
                d={s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}
                fill="none"
                stroke={s.color}
                strokeWidth={2.4}
                strokeDasharray={s.dashed ? "6 5" : undefined}
                strokeLinejoin="round"
              />
              {s.values.map((v, i) => (
                <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 4.5 : labels.length > 40 ? 0 : 2.6} fill="white" stroke={s.color} strokeWidth={2} />
              ))}
            </g>
          ))}
          {labels.map((l, i) =>
            i % every === 0 || i === labels.length - 1 ? (
              <text key={l.key} x={x(i)} y={H - 8} textAnchor="middle" className={`text-[10px] ${hover === i ? "fill-slate-900 font-bold" : "fill-slate-500"}`}>
                {l.short}
              </text>
            ) : null
          )}
        </svg>
        {hover != null && (
          <div
            className="pointer-events-none absolute top-1 z-10 min-w-44 rounded-lg bg-slate-900/95 px-3 py-2 text-xs text-white shadow-lg"
            style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${x(hover) > W * 0.6 ? "-105%" : "8px"})` }}
          >
            <div className="mb-1 font-bold">{labels[hover].long}</div>
            {visible.map((s) => (
              <div key={s.name} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.name}
                </span>
                <span className="font-semibold tabular-nums">SAR {money(s.values[hover] ?? 0)}</span>
              </div>
            ))}
            {pickHint && <div className="mt-1 text-[10px] text-slate-300">{pickHint}</div>}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        {series.map((s) => (
          <button
            key={s.name}
            type="button"
            onClick={() =>
              setHidden((h) => {
                const n = new Set(h);
                if (n.has(s.name)) n.delete(s.name);
                else n.add(s.name);
                return n;
              })
            }
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ring-1 ring-slate-200 transition-opacity ${hidden.has(s.name) ? "opacity-40" : ""}`}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
            {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}
