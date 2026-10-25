"use client";

import { useState, type ReactNode } from "react";

export type TipRow = { label: string; value: string; color?: string; strong?: boolean };

/** The details card: a title and label/value rows, optional footnote. */
export function TipCard({ title, rows, note }: { title: string; rows: TipRow[]; note?: string }) {
  return (
    <div className="min-w-44">
      <div className="mb-1 font-bold">{title}</div>
      <div className="space-y-0.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-white/75">
              {r.color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: r.color }} />}
              {r.label}
            </span>
            <span className={`tabular-nums ${r.strong ? "font-bold" : "font-semibold"}`}>{r.value}</span>
          </div>
        ))}
      </div>
      {note && <div className="mt-1.5 border-t border-white/15 pt-1 text-[11px] text-white/60">{note}</div>}
    </div>
  );
}

type Pos = { x: number; y: number; tip: ReactNode };

function Layer({ state }: { state: Pos }) {
  // Keep the card on screen: flip left/up near the right/bottom edges.
  const flipX = state.x > window.innerWidth - 260;
  const flipY = state.y > window.innerHeight - 200;
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[60] rounded-lg bg-[#1d1d1f]/95 px-3 py-2 text-xs text-white shadow-xl ring-1 ring-white/10"
      style={{
        left: state.x + (flipX ? -14 : 14),
        top: state.y + (flipY ? -14 : 14),
        transform: `translate(${flipX ? "-100%" : "0"}, ${flipY ? "-100%" : "0"})`,
      }}
    >
      {state.tip}
    </div>
  );
}

/**
 * Hover details for many marks in one chart (bars, SVG shapes, table rows):
 * spread `bind(tip)` onto each mark and render `layer` once anywhere in the
 * chart. The card follows the cursor.
 */
export function useHoverCard() {
  const [state, setState] = useState<Pos | null>(null);
  const bind = (tip: ReactNode) => ({
    onMouseEnter: (e: React.MouseEvent) => setState({ x: e.clientX, y: e.clientY, tip }),
    onMouseMove: (e: React.MouseEvent) => setState({ x: e.clientX, y: e.clientY, tip }),
    onMouseLeave: () => setState(null),
  });
  return { bind, layer: state ? <Layer state={state} /> : null };
}

/** Single-mark convenience wrapper (a div) with hover details. */
export function Hover({ tip, children, className, style }: { tip: ReactNode; children?: ReactNode; className?: string; style?: React.CSSProperties }) {
  const { bind, layer } = useHoverCard();
  return (
    <div className={className} style={style} {...bind(tip)}>
      {children}
      {layer}
    </div>
  );
}
