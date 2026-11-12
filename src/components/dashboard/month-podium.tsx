"use client";

import { useState } from "react";
import { Podium } from "@/components/podium";
import type { StandingsEntry } from "@/lib/standings";

/** A podium per audit month: the newest month first, a picker for the others. */
export function MonthPodium({ months }: { months: { id: string; label: string; entries: StandingsEntry[] }[] }) {
  const [id, setId] = useState(months[0].id);
  const current = months.find((m) => m.id === id) ?? months[0];
  return (
    <div className="space-y-4">
      {months.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Audit month">
          {months.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={m.id === current.id}
              onClick={() => setId(m.id)}
              className={`rounded-full px-3 py-1 text-[13px] font-semibold ring-1 transition ${
                m.id === current.id ? "bg-[#1d1d1f] text-white ring-[#1d1d1f]" : "bg-white text-[#1d1d1f] ring-black/10 hover:bg-[#f5f5f7]"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
      <Podium entries={current.entries} />
    </div>
  );
}
