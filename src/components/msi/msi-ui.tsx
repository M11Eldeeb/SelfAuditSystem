"use client";

import type { ReactNode } from "react";

// Shared bits of the Major Service Indicators page: number formats and the little table pieces. Amounts are SAR.

export const money = (v: number | null | undefined): string => (v == null ? "—" : Math.round(v).toLocaleString("en-US"));
export const dec = (v: number | null | undefined, digits = 1): string => (v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }));
/** A fraction as a percentage: 0.7348 -> "73%". */
export const pct = (v: number | null | undefined, digits = 0): string => (v == null ? "—" : `${(v * 100).toFixed(digits)}%`);
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtDay = (iso: string): string => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Green when the target is reached, amber when close, red when far. `good`: the fraction at which it counts as reached. */
export function tone(v: number | null | undefined, good = 1): string {
  if (v == null) return "text-[#6e6e73]";
  if (v >= good) return "text-[#248a3d]";
  if (v >= good * 0.9) return "text-[#b45309]";
  return "text-[#d70015]";
}

/** A percentage that is coloured against the target. */
export function Pct({ v, good = 1, digits = 0, className = "" }: { v: number | null | undefined; good?: number; digits?: number; className?: string }) {
  return <span className={`font-semibold tabular-nums ${tone(v, good)} ${className}`}>{pct(v, digits)}</span>;
}

/** A thin progress bar (0-100+% of target). */
export function Bar({ v, color = "#c4121a" }: { v: number | null | undefined; color?: string }) {
  const w = v == null ? 0 : Math.max(0, Math.min(1, v)) * 100;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#ececf0]">
      <div className="h-full rounded-full" style={{ width: `${w}%`, backgroundColor: color }} />
    </div>
  );
}

export function Chips<T extends string>({ items, value, onChange, label }: { items: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => onChange(it.id)}
          aria-pressed={it.id === value}
          className={`rounded-full px-3 py-1 text-[13px] font-semibold ring-1 transition ${it.id === value ? "bg-[#1d1d1f] text-white ring-[#1d1d1f]" : "bg-white text-[#1d1d1f] ring-black/10 hover:bg-[#f5f5f7]"}`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export const th = "px-3 py-2 text-left text-[11px] font-semibold tracking-wide text-[#6e6e73] uppercase whitespace-nowrap";
export const thr = `${th} text-right`;
export const td = "px-3 py-2 whitespace-nowrap";
export const tdr = `${td} text-right tabular-nums`;

export function TableWrap({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`overflow-x-auto rounded-xl ring-1 ring-[#ececec] ${className}`}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-[#f5f5f7] px-4 py-8 text-center text-sm text-[#6e6e73]">{children}</p>;
}
