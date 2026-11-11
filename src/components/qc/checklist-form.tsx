"use client";

import { useState } from "react";
import { BRAKE_MEASURES, WHEELS, sectionsFor, sheetTitle, type Checklist, type Mark } from "@/lib/qc/checklist";

// The inspection sheet on a phone: one row per item with big Good / Inspect / Repair buttons, "All good" per section,
// and the few numbers the sheets ask (tire pressure and torque, brake pad and disk thickness, tire production date).

const input = "w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-base shadow-sm focus:border-brand focus:outline-none sm:text-sm";

const MARK_STYLE: Record<Mark, string> = {
  G: "bg-emerald-600 text-white ring-emerald-600",
  I: "bg-amber-500 text-white ring-amber-500",
  R: "bg-red-600 text-white ring-red-600",
  NA: "bg-neutral-600 text-white ring-neutral-600",
};
const MARK_SHORT: Record<Mark, string> = { G: "Good", I: "Inspect", R: "Repair", NA: "N/A" };

function Marks({ marks, optional, value, onChange }: { marks: "GIR" | "GR"; optional?: boolean; value?: Mark; onChange: (m: Mark) => void }) {
  const list: Mark[] = [...(marks === "GIR" ? (["G", "I", "R"] as Mark[]) : (["G", "R"] as Mark[])), ...(optional ? (["NA"] as Mark[]) : [])];
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${list.length}, minmax(0, 1fr))` }}>
      {list.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          aria-pressed={value === m}
          className={`min-h-10 rounded-lg px-1 text-[13px] font-semibold ring-1 transition active:scale-[0.97] ${value === m ? MARK_STYLE[m] : "bg-white text-neutral-700 ring-neutral-300"}`}
        >
          {MARK_SHORT[m]}
        </button>
      ))}
    </div>
  );
}

export function ChecklistForm({ value, onChange }: { value: Checklist; onChange: (c: Checklist) => void }) {
  const sections = sectionsFor(value.repairType);
  const [openComment, setOpenComment] = useState<Record<string, boolean>>({});
  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const done = sections.reduce((n, s) => n + s.items.filter((i) => value.answers[i.id]).length, 0);
  const set = (patch: Partial<Checklist>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-neutral-700">{sheetTitle(value.repairType)}</div>
        <div className={`rounded-full px-2.5 py-1 text-xs font-bold ${done === total ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-700"}`}>
          {done} / {total}
        </div>
      </div>
      {sections.map((s) => (
        <div key={s.id} className="space-y-3 rounded-xl bg-neutral-50 p-3 ring-1 ring-neutral-200">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-bold text-neutral-900">{s.title}</div>
            <button
              type="button"
              onClick={() => set({ answers: { ...value.answers, ...Object.fromEntries(s.items.filter((i) => !value.answers[i.id]).map((i) => [i.id, "G" as Mark])) } })}
              className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200 active:bg-emerald-50"
            >
              ✓ All good
            </button>
          </div>
          {s.items.map((i) => (
            <div key={i.id} className="space-y-1.5">
              <div className="text-sm text-neutral-800">{i.label}</div>
              <Marks marks={i.marks} optional={i.optional} value={value.answers[i.id]} onChange={(m) => set({ answers: { ...value.answers, [i.id]: m } })} />
              {i.clarify && value.answers[i.id] && value.answers[i.id] !== "G" && value.answers[i.id] !== "NA" && (
                <input value={value.clarify[i.id] ?? ""} onChange={(e) => set({ clarify: { ...value.clarify, [i.id]: e.target.value } })} placeholder="Clarify" className={input} />
              )}
            </div>
          ))}

          {s.extra === "wheels" && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-neutral-600">Tire pressure (psi) and torque (Nm)</div>
              <div className="grid grid-cols-2 gap-2">
                {WHEELS.map((w) => (
                  <div key={w} className="space-y-1 rounded-lg bg-white p-2 ring-1 ring-neutral-200">
                    <div className="text-xs font-bold text-neutral-700">{w}</div>
                    <input
                      value={value.wheels[w]?.pressure ?? ""}
                      onChange={(e) => set({ wheels: { ...value.wheels, [w]: { ...value.wheels[w], pressure: e.target.value.replace(/[^\d.]/g, "") } } })}
                      inputMode="decimal"
                      placeholder="Pressure"
                      className={input}
                    />
                    <input
                      value={value.wheels[w]?.torque ?? ""}
                      onChange={(e) => set({ wheels: { ...value.wheels, [w]: { ...value.wheels[w], torque: e.target.value.replace(/[^\d.]/g, "") } } })}
                      inputMode="decimal"
                      placeholder="Torque"
                      className={input}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {s.extra === "brakes" && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-neutral-600">Brake pads & disks (mm)</div>
              <div className="grid grid-cols-2 gap-2">
                {BRAKE_MEASURES.map((b) => (
                  <label key={b.id} className="space-y-1">
                    <span className="text-xs text-neutral-600">{b.label}</span>
                    <input value={value.brakes[b.id] ?? ""} onChange={(e) => set({ brakes: { ...value.brakes, [b.id]: e.target.value.replace(/[^\d.]/g, "") } })} inputMode="decimal" placeholder="mm" className={input} />
                  </label>
                ))}
              </div>
              <label className="block space-y-1">
                <span className="text-xs text-neutral-600">Tire production date (week + year, e.g. 2324)</span>
                <input value={value.tireDate ?? ""} onChange={(e) => set({ tireDate: e.target.value.replace(/[^\d/]/g, "").slice(0, 7) })} inputMode="numeric" placeholder="WWYY" className={input} />
              </label>
            </div>
          )}

          {openComment[s.id] || value.comments[s.id] ? (
            <textarea value={value.comments[s.id] ?? ""} onChange={(e) => set({ comments: { ...value.comments, [s.id]: e.target.value } })} rows={2} placeholder={`${s.title} comments`} className={input} />
          ) : (
            <button type="button" onClick={() => setOpenComment({ ...openComment, [s.id]: true })} className="text-xs font-semibold text-brand">
              + Comment
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
