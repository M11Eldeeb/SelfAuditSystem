"use client";

import { useState } from "react";

export type NavItem = { index: number; label: string; workOrderNo: string | null; announced: boolean; documentsDone: boolean; partsDone: boolean };

/**
 * The audit's claims to jump between. By default only the ones still to do in this step and mode (a reviewed claim
 * drops out of the list); "Show all" brings the reviewed ones back. Jumping saves the claim being worked on first (the
 * same way the search does), so nothing typed is lost.
 */
export function ClaimNavigator({ items, currentIndex, mode, announced }: { items: NavItem[]; currentIndex: number; mode: "documents" | "parts"; announced: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const done = (it: NavItem) => (mode === "parts" ? it.partsDone : it.documentsDone);
  const inStep = items.filter((it) => it.announced === announced);
  const reviewed = inStep.filter(done).length;
  const list = showAll ? inStep : inStep.filter((it) => !done(it) || it.index === currentIndex);

  function jump(index: number) {
    if (index === currentIndex) return;
    const form = document.getElementById("internal-audit-claim-form") as HTMLFormElement | null;
    const input = document.getElementById("jump_to_index_input") as HTMLInputElement | null;
    if (!form || !input) return;
    input.value = String(index);
    form.requestSubmit();
  }

  return (
    <div className="space-y-2 rounded-xl border border-neutral-200/70 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-neutral-900">
          {showAll ? `All claims (${inStep.length})` : `To do (${inStep.length - reviewed})`}
          <span className="ml-2 text-xs font-normal text-neutral-500">{reviewed} reviewed</span>
        </p>
        {reviewed > 0 && (
          <button type="button" onClick={() => setShowAll((v) => !v)} className="rounded-lg border border-neutral-300 bg-white px-3 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">
            {showAll ? "Hide reviewed" : `Show all (${inStep.length})`}
          </button>
        )}
      </div>
      {list.length === 0 ? (
        <p className="text-xs text-neutral-500">Every claim of this step is reviewed - use “Show all” or the search to open one again.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {list.map((it) => {
            const isDone = done(it);
            const current = it.index === currentIndex;
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
      )}
    </div>
  );
}
