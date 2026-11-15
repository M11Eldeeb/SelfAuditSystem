"use client";

import { useState } from "react";

export type NavItem = { index: number; label: string; workOrderNo: string | null; announced: boolean; documentsDone: boolean; partsDone: boolean };

/**
 * "Show all claims": the whole list of the audit's claims (reviewed ones marked ✓), hidden until asked for. Jumping
 * saves the claim being worked on first (the same way the search does), so nothing typed is lost.
 */
export function ClaimNavigator({ items, currentIndex, mode }: { items: NavItem[]; currentIndex: number; mode: "documents" | "parts" }) {
  const [open, setOpen] = useState(false);
  const done = (it: NavItem) => (mode === "parts" ? it.partsDone : it.documentsDone);

  function jump(index: number) {
    if (index === currentIndex) return;
    const form = document.getElementById("internal-audit-claim-form") as HTMLFormElement | null;
    const input = document.getElementById("jump_to_index_input") as HTMLInputElement | null;
    if (!form || !input) return;
    input.value = String(index);
    form.requestSubmit();
  }

  return (
    <div className="space-y-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-50">
        {open ? "Hide claims" : `Show all claims (${items.length})`}
      </button>
      {open && (
        <div className="space-y-3 rounded-xl border border-neutral-200/70 bg-white p-3 shadow-sm">
          {[true, false].map((announced) => {
            const list = items.filter((it) => it.announced === announced);
            if (!list.length) return null;
            return (
              <div key={String(announced)} className="space-y-1.5">
                {items.some((it) => !it.announced) && <p className="text-xs font-semibold text-neutral-500">{announced ? "Announced" : "Unannounced"}</p>}
                <div className="flex flex-wrap gap-1.5">
                  {list.map((it) => {
                    const current = it.index === currentIndex;
                    const isDone = done(it);
                    return (
                      <button
                        key={it.index}
                        type="button"
                        onClick={() => jump(it.index)}
                        title={it.label}
                        className={`rounded-lg px-2.5 py-1 text-xs font-medium ring-1 transition ${
                          current ? "bg-neutral-900 text-white ring-neutral-900" : isDone ? "bg-emerald-50 text-emerald-800 ring-emerald-200 hover:bg-emerald-100" : "bg-white text-neutral-700 ring-neutral-300 hover:bg-neutral-50"
                        }`}
                      >
                        {isDone && !current ? "✓ " : ""}
                        {it.workOrderNo ?? it.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
