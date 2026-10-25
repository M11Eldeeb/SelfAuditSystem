"use client";

import { useState, type ReactNode } from "react";
import { TipCard, useHoverCard } from "@/components/dashboard/hover";

// Dependency-free SVG/CSS charts for the KPI dashboard. Server-rendered;
// hover details come from native <title> tooltips.

export const C = {
  primary: "#9a000d",
  red: "#c4121a",
  // MG brand: red, charcoal black and silver grey (the "blue" names are kept so every chart picks the new colours up).
  blue: "#2d2d2d",
  blueLight: "#6b6e73",
  blueSoft: "#c9cbcf",
  slate: "#6e6e73",
  slateSoft: "#c7c7cc",
  track: "var(--chart-track)",
  grid: "var(--chart-grid)",
  green: "#059669",
  amber: "#d97706",
};

export const SERIES_COLORS = [
  "#c4121a", // MG red
  "#2d2d2d", // MG black
  "#8a8d91", // MG silver
  "#7a0010", // deep red
  "#e2747b", // light red
  "#55585c", // graphite
  "#b9bcc0", // light silver
  "#d97706",
  "#0f766e",
  "#6d28d9",
  "#0369a1",
];

export function monthShort(yyyyMM: string): string {
  const [y, m] = yyyyMM.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
}

function dayShort(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export type LineSeries = { name: string; color: string; points: { month: string; value: number }[] };

export function LineChart({
  series,
  yMax = 100,
  unit = "%",
  emptyText = "No data yet.",
}: {
  series: LineSeries[];
  yMax?: number;
  unit?: string;
  emptyText?: string;
}) {
  // Legend entries toggle their line; hovering a month shows every visible
  // branch's value for it.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const months = [...new Set(series.flatMap((s) => s.points.map((p) => p.month)))].sort();
  if (months.length === 0) return <p className="py-12 text-center text-sm text-neutral-500">{emptyText}</p>;

  const W = 640;
  const H = 230;
  const pad = { top: 12, right: 16, bottom: 28, left: 38 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (months.length === 1 ? innerW / 2 : (i / (months.length - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - (Math.min(Math.max(v, 0), yMax) / yMax) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * yMax));
  const labelEvery = Math.ceil(months.length / 10);
  const visible = series.filter((s) => !hidden.has(s.name));
  const single = visible.length === 1 ? visible[0] : null;
  const gradId = `fill-${(single?.name ?? "x").replace(/\W/g, "")}`;
  const hoverValues =
    hover == null
      ? []
      : visible
          .map((s) => ({ s, p: s.points.find((p) => p.month === months[hover]) }))
          .filter((v): v is { s: LineSeries; p: { month: string; value: number } } => !!v.p)
          .sort((a, b) => b.p.value - a.p.value);

  return (
    <div className="space-y-3">
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          role="img"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - rect.left) / rect.width) * W;
            const i = months.length === 1 ? 0 : Math.round(((px - pad.left) / innerW) * (months.length - 1));
            setHover(Math.min(Math.max(i, 0), months.length - 1));
          }}
        >
          {single && (
            <defs>
              <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={single.color} stopOpacity="0.22" />
                <stop offset="100%" stopColor={single.color} stopOpacity="0" />
              </linearGradient>
            </defs>
          )}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke={C.grid} strokeDasharray={t === 0 ? undefined : "3 4"} />
              <text x={pad.left - 6} y={y(t) + 4} textAnchor="end" className="fill-neutral-400 text-[11px]">
                {t}
                {unit}
              </text>
            </g>
          ))}
          {months.map((m, i) =>
            i % labelEvery === 0 || i === months.length - 1 ? (
              <text key={m} x={x(i)} y={H - 8} textAnchor="middle" className={`text-[11px] ${hover === i ? "fill-neutral-900 font-bold" : "fill-neutral-500"}`}>
                {monthShort(m)}
              </text>
            ) : null
          )}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + innerH} stroke="var(--chart-cursor)" strokeOpacity="0.15" />}
          {visible.map((s) => {
            const pts = s.points.map((p) => ({ i: months.indexOf(p.month), v: p.value })).sort((a, b) => a.i - b.i);
            const d = pts.map((p, k) => `${k === 0 ? "M" : "L"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
            return (
              <g key={s.name}>
                {single && pts.length > 1 && (
                  <path d={`${d} L${x(pts[pts.length - 1].i).toFixed(1)},${y(0)} L${x(pts[0].i).toFixed(1)},${y(0)} Z`} fill={`url(#${gradId})`} />
                )}
                <path d={d} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
                {pts.map((p) => (
                  <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={hover === p.i ? 5 : 3.5} fill={hover === p.i ? s.color : "var(--surface)"} stroke={s.color} strokeWidth={2} />
                ))}
              </g>
            );
          })}
        </svg>
        {hover != null && hoverValues.length > 0 && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-36 rounded-lg bg-[#1d1d1f] px-3 py-2 text-xs text-white shadow-lg"
            style={x(hover) > W * 0.6 ? { right: `${((W - x(hover)) / W) * 100 + 2}%` } : { left: `${(x(hover) / W) * 100 + 2}%` }}
          >
            <div className="mb-1 font-bold">{monthShort(months[hover])}</div>
            {hoverValues.slice(0, 8).map(({ s, p }) => (
              <div key={s.name} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.name}
                </span>
                <span className="font-semibold tabular-nums">
                  {p.value.toFixed(1)}
                  {unit}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      {series.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {series.map((s) => {
            const off = hidden.has(s.name);
            return (
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
                className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ring-1 ring-[#e5e5ea] transition ${off ? "text-neutral-400 line-through" : "bg-white text-neutral-700 hover:bg-[#f5f5f7]"}`}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: off ? "#c7c7cc" : s.color }} />
                {s.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Circular progress dial with a centered value. `pct` is 0-100. */
export function Ring({
  pct,
  size = 72,
  stroke = 8,
  color = C.red,
  center,
  caption,
  tip,
}: {
  pct: number | null;
  size?: number;
  stroke?: number;
  color?: string;
  center: string;
  caption?: string;
  /** Hover details; defaults to the value and caption. */
  tip?: ReactNode;
}) {
  const r = 50 - stroke / 2 - 1;
  const circ = 2 * Math.PI * r;
  const p = pct == null ? 0 : Math.min(Math.max(pct, 0), 100);
  const { bind, layer } = useHoverCard();
  return (
    <div
      className="relative shrink-0 cursor-default"
      style={{ width: size, height: size }}
      {...bind(tip ?? <TipCard title={caption ? caption[0].toUpperCase() + caption.slice(1) : "Value"} rows={[{ label: "Value", value: center, strong: true }, { label: "Remaining", value: pct == null ? "—" : `${(100 - p).toFixed(1)}%` }]} />)}
    >
      {layer}
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke={C.track} strokeWidth={stroke} />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(p / 100) * circ} ${circ}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="font-display text-sm font-bold text-neutral-900">{center}</span>
        {caption && <span className="mt-0.5 text-[8px] font-semibold tracking-wider text-neutral-500 uppercase">{caption}</span>}
      </div>
    </div>
  );
}

export type Segment = { label: string; value: number; color: string };

/** One horizontal bar split into proportional segments, with an optional legend. */
export function StackedBar({ segments, height = "h-2.5", legend = true, format }: { segments: Segment[]; height?: string; legend?: boolean; format?: (v: number) => string }) {
  const total = segments.reduce((s, x) => s + Math.max(x.value, 0), 0);
  const { bind, layer } = useHoverCard();
  const fmt = (v: number) => (format ? format(v) : v.toLocaleString("en-US"));
  return (
    <div className="space-y-1.5">
      {layer}
      <div className={`flex w-full gap-0.5 overflow-hidden rounded-full bg-[#ececf0] ${height}`}>
        {total > 0 &&
          segments.map((s) =>
            s.value > 0 ? (
              <div
                key={s.label}
                className="h-full cursor-default transition-[filter] first:rounded-l-full last:rounded-r-full hover:brightness-110"
                style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }}
                {...bind(
                  <TipCard
                    title={s.label}
                    rows={[
                      { label: "Value", value: fmt(s.value), color: s.color, strong: true },
                      { label: "Share", value: `${((s.value / total) * 100).toFixed(1)}%` },
                      { label: "Of total", value: fmt(total) },
                    ]}
                  />
                )}
              />
            ) : null
          )}
      </div>
      {legend && (
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-[11px] text-neutral-500">
          {segments.map((s) => (
            <span key={s.label} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />
              {s.label}: <span className="font-semibold text-neutral-800">{format ? format(s.value) : s.value.toLocaleString("en-US")}</span>
              {total > 0 && <span>({((s.value / total) * 100).toFixed(0)}%)</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Simple progress track. */
export function Meter({ pct, color = C.red, height = "h-2", tip }: { pct: number; color?: string; height?: string; tip?: ReactNode }) {
  const { bind, layer } = useHoverCard();
  return (
    <div className={`w-full overflow-hidden rounded-full bg-[#ececf0] ${height}`} {...(tip ? bind(tip) : {})}>
      {layer}
      <div className="h-full rounded-full" style={{ width: `${Math.min(Math.max(pct, 0), 100)}%`, backgroundColor: color }} />
    </div>
  );
}

/** Donut of a few segments with a big number in the middle. */
export function Donut({ segments, center, caption, onSelect }: { segments: Segment[]; center: string; caption: string; onSelect?: (label: string) => void }) {
  const r = 38;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + Math.max(x.value, 0), 0) || 1;
  const arcs = segments.map((s, i) => ({
    ...s,
    len: (Math.max(s.value, 0) / total) * circ,
    start: segments.slice(0, i).reduce((acc, x) => acc + (Math.max(x.value, 0) / total) * circ, 0),
  }));
  const { bind, layer } = useHoverCard();
  return (
    <div className="relative mx-auto h-44 w-44">
      {layer}
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--chart-track)" strokeWidth="12" />
        {arcs.map((s) => (
          <circle
            key={s.label}
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth="12"
            strokeDasharray={`${s.len} ${circ}`}
            strokeDashoffset={-s.start}
            className={`${onSelect ? "cursor-pointer" : "cursor-default"} transition-[stroke-width] hover:[stroke-width:14]`}
            onClick={onSelect ? () => onSelect(s.label) : undefined}
            {...bind(
              <TipCard
                title={s.label}
                rows={[
                  { label: "Amount", value: s.value.toLocaleString("en-US", { maximumFractionDigits: 0 }), color: s.color, strong: true },
                  { label: "Share", value: `${((s.value / total) * 100).toFixed(1)}%` },
                ]}
              />
            )}
          />
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-3xl font-bold text-[#9a000d]">{center}</span>
        <span className="text-xs font-medium text-neutral-500">{caption}</span>
      </div>
    </div>
  );
}

/**
 * Grouped columns (two series per bucket) with an optional line overlaid -
 * claimed vs adjusted per period, or repaired vs submitted per weekday.
 */
export function GroupedColumns({
  groups,
  seriesNames,
  colors = [C.blueLight, C.green],
  format,
  highlight,
  line,
}: {
  groups: { label: string; sub?: string; values: [number, number] }[];
  seriesNames: [string, string];
  colors?: [string, string];
  format: (v: number) => string;
  highlight?: (index: number) => boolean;
  line?: { name: string; values: number[]; color: string; format: (v: number) => string };
}) {
  const max = Math.max(...groups.flatMap((g) => g.values), 1);
  const lineMax = line ? Math.max(...line.values.map(Math.abs), 1) : 1;
  const { bind, layer } = useHoverCard();
  return (
    <div className="space-y-3">
      {layer}
      <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-600">
        {seriesNames.map((n, i) => (
          <span key={n} className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: colors[i] }} />
            {n}
          </span>
        ))}
        {line && (
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3" style={{ backgroundColor: line.color }} />
            {line.name}
          </span>
        )}
      </div>
      <div className="relative">
        <div className="flex h-52 items-end gap-2 border-b border-[#e5e5ea] px-1">
          {groups.map((g, i) => (
            <div
              key={g.label}
              className={`group flex h-full min-w-0 flex-1 cursor-default flex-col items-center justify-end rounded-t-lg pt-5 transition-colors hover:bg-[#f5f5f7] ${highlight?.(i) ? "bg-[#ffdad6]/30" : ""}`}
              {...bind(
                <TipCard
                  title={`${g.label}${g.sub ? ` · ${g.sub}` : ""}`}
                  rows={[
                    { label: seriesNames[0], value: format(g.values[0]), color: colors[0] },
                    { label: seriesNames[1], value: format(g.values[1]), color: colors[1] },
                    {
                      label: "Difference",
                      value: `${format(g.values[1] - g.values[0])}${g.values[0] ? ` (${(((g.values[1] - g.values[0]) / g.values[0]) * 100).toFixed(1)}%)` : ""}`,
                      strong: true,
                    },
                    ...(line ? [{ label: line.name, value: line.format(line.values[i]), color: line.color }] : []),
                  ]}
                />
              )}
            >
              <div className="mb-1 text-[11px] font-semibold whitespace-nowrap text-neutral-500 opacity-0 transition-opacity group-hover:opacity-100">
                {format(g.values[0])} / {format(g.values[1])}
              </div>
              <div className="flex h-full w-full max-w-14 items-end justify-center gap-1">
                {g.values.map((v, k) => (
                  <div
                    key={k}
                    className="w-1/2 rounded-t transition-[filter] group-hover:brightness-110"
                    style={{ height: `${Math.max((v / max) * 100, v > 0 ? 1.5 : 0)}%`, backgroundColor: colors[k] }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        {line && groups.length > 1 && (
          <svg viewBox={`0 0 ${groups.length * 100} 100`} preserveAspectRatio="none" className="pointer-events-none absolute inset-x-1 top-5 h-[calc(13rem-1.25rem)] w-[calc(100%-0.5rem)] overflow-visible">
            <polyline
              points={line.values.map((v, i) => `${i * 100 + 50},${100 - (Math.abs(v) / lineMax) * 90}`).join(" ")}
              fill="none"
              stroke={line.color}
              strokeWidth="2.5"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
      <div className="flex gap-2 px-1">
        {groups.map((g, i) => (
          <div key={g.label} className="min-w-0 flex-1 text-center">
            <div className={`truncate text-[11px] font-bold ${highlight?.(i) ? "text-[#9a000d]" : "text-neutral-800"}`}>{g.label}</div>
            {g.sub && <div className="truncate text-[11px] text-neutral-500">{g.sub}</div>}
            {line && <div className="truncate text-[11px] font-semibold" style={{ color: line.color }}>{line.format(line.values[i])}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ColumnChart({
  points,
  format,
}: {
  points: { label: string; value: number; tooltip: string }[];
  format: (v: number) => string;
}) {
  const max = Math.max(...points.map((p) => p.value), 1);
  const avg = points.reduce((s, p) => s + p.value, 0) / Math.max(points.length, 1);
  const { bind, layer } = useHoverCard();
  return (
    <div className="flex h-48 items-end gap-2">
      {layer}
      {points.map((p, i) => (
        <div
          key={p.label}
          className="flex h-full min-w-0 flex-1 cursor-default flex-col items-center justify-end gap-1 rounded-t-md transition-colors hover:bg-[#f5f5f7]"
          {...bind(
            <TipCard
              title={monthShort(p.label)}
              rows={[
                { label: "Value", value: format(p.value), strong: true },
                ...(i > 0 && points[i - 1].value
                  ? [{ label: "vs previous", value: `${p.value >= points[i - 1].value ? "+" : ""}${(((p.value - points[i - 1].value) / points[i - 1].value) * 100).toFixed(1)}%` }]
                  : []),
                { label: "vs average", value: avg ? `${p.value >= avg ? "+" : ""}${(((p.value - avg) / avg) * 100).toFixed(1)}%` : "—" },
              ]}
              note={p.tooltip}
            />
          )}
        >
          <span className="text-[11px] font-semibold text-neutral-600 tabular-nums">{format(p.value)}</span>
          <div className="w-full max-w-12 rounded-t-md" style={{ height: `${Math.max((p.value / max) * 100, 1.5)}%`, background: `linear-gradient(to top, ${C.primary}, ${C.red})` }} />
          <span className="truncate text-[11px] text-neutral-500">{monthShort(p.label)}</span>
        </div>
      ))}
    </div>
  );
}

export function BarList({
  items,
  valueLabel,
  color = C.red,
}: {
  items: { label: string; sublabel?: string; value: number; display: string; secondary?: string }[];
  valueLabel?: string;
  color?: string;
}) {
  const { bind, layer } = useHoverCard();
  if (items.length === 0) return <p className="py-6 text-center text-sm text-neutral-500">Nothing in this period.</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  const sum = items.reduce((s, i) => s + i.value, 0) || 1;
  return (
    <div className="space-y-1.5">
      {layer}
      {valueLabel && <div className="flex justify-end text-[11px] font-bold tracking-wider text-neutral-400 uppercase">{valueLabel}</div>}
      {items.map((item, idx) => (
        <div
          key={`${item.label}|${item.sublabel ?? ""}|${idx}`}
          className="group flex cursor-default items-center gap-3 rounded-md text-sm"
          {...bind(
            <TipCard
              title={item.label}
              rows={[
                ...(item.sublabel ? [{ label: "Code / detail", value: item.sublabel }] : []),
                { label: "Rank", value: `${idx + 1} of ${items.length}` },
                { label: valueLabel?.split("·")[0]?.trim() || "Value", value: item.display, strong: true },
                ...(item.secondary ? [{ label: valueLabel?.split("·")[1]?.trim() || "Detail", value: item.secondary }] : []),
                { label: "Share of list", value: `${((item.value / sum) * 100).toFixed(1)}%` },
              ]}
            />
          )}
        >
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-[11px] font-bold ${
              idx === 0 ? "bg-[#9a000d] text-white" : "bg-[#e5e5ea] text-neutral-800"
            }`}
          >
            {String(idx + 1).padStart(2, "0")}
          </span>
          <div className="relative min-w-0 flex-1 overflow-hidden rounded-md bg-[#f5f5f7]">
            <div className="absolute inset-y-0 left-0 rounded-md opacity-15 transition-opacity group-hover:opacity-25" style={{ width: `${(item.value / max) * 100}%`, backgroundColor: color }} />
            <div className="relative flex min-w-0 items-baseline gap-2 px-2.5 py-1.5">
              <span className="shrink-0 font-semibold text-neutral-900">{item.label}</span>
              {item.sublabel && <span className="truncate text-xs text-neutral-500">{item.sublabel}</span>}
            </div>
          </div>
          <div className="w-24 shrink-0 text-right">
            <div className="font-semibold text-neutral-900 tabular-nums">{item.display}</div>
            {item.secondary && <div className="text-[11px] text-neutral-500 tabular-nums">{item.secondary}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

export { dayShort };
