"use client";

import { useState } from "react";
import { DAMAGE_KINDS, type DamageKind, type DamageMark } from "@/lib/courtesy/agreements";

const colorOf = (k: DamageKind) => DAMAGE_KINDS.find((x) => x.id === k)?.color ?? "#d70015";

/**
 * The walk-around drawing of the car. Editable: pick the kind of damage, tap the drawing where it is (tap a mark to remove
 * it). Read-only: the marks, numbered.
 */
export function DamageDiagram({ marks, onChange }: { marks: DamageMark[]; onChange?: (m: DamageMark[]) => void }) {
  const [kind, setKind] = useState<DamageKind>("scratch");
  const edit = !!onChange;
  return (
    <div className="space-y-2">
      {edit && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Kind of damage">
          {DAMAGE_KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => setKind(k.id)}
              aria-pressed={kind === k.id}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${kind === k.id ? "bg-neutral-900 text-white ring-neutral-900" : "bg-white text-neutral-800 ring-black/10"}`}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: k.color }} />
              {k.en}
            </button>
          ))}
          {marks.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="ml-auto text-xs font-semibold text-neutral-500 underline">
              Remove all marks
            </button>
          )}
        </div>
      )}
      <div
        className={`relative overflow-hidden rounded-xl border border-neutral-200 bg-white ${edit ? "cursor-crosshair" : ""}`}
        onClick={(e) => {
          if (!edit) return;
          const r = e.currentTarget.getBoundingClientRect();
          onChange([...marks, { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, kind }]);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/courtesy/walkaround.jpg" alt="Walk-around drawing of the car" className="block w-full select-none" draggable={false} />
        {marks.map((m, i) => (
          <button
            key={i}
            type="button"
            title={`${i + 1}. ${DAMAGE_KINDS.find((k) => k.id === m.kind)?.en ?? m.kind}${edit ? " - tap to remove" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              if (edit) onChange(marks.filter((_, j) => j !== i));
            }}
            className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[11px] font-bold text-white shadow ring-2 ring-white"
            style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, backgroundColor: colorOf(m.kind) }}
          >
            {i + 1}
          </button>
        ))}
      </div>
      {edit ? (
        <p className="text-xs text-neutral-500">Choose the kind of damage, then tap the drawing where it is. Tap a mark to remove it. No marks = no damage.</p>
      ) : (
        marks.length > 0 && (
          <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
            {marks.map((m, i) => (
              <li key={i}>
                <b style={{ color: colorOf(m.kind) }}>{i + 1}.</b> {DAMAGE_KINDS.find((k) => k.id === m.kind)?.en}
              </li>
            ))}
          </ol>
        )
      )}
    </div>
  );
}
