"use client";

import { useState } from "react";

type SearchItem = { index: number; workOrderNo: string | null; claimNumber: string };

export function WorkOrderSearch({
  currentIndex,
  items,
}: {
  currentIndex: number;
  items: SearchItem[];
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = value.trim().toLowerCase();
    if (!q) return;

    const exact = items.find(
      (it) => (it.workOrderNo ?? "").toLowerCase() === q || it.claimNumber.toLowerCase() === q
    );
    const partial =
      exact ??
      items.find(
        (it) => (it.workOrderNo ?? "").toLowerCase().includes(q) || it.claimNumber.toLowerCase().includes(q)
      );

    if (!partial) {
      setError("No claim in this audit matches that work order or claim number.");
      return;
    }
    setError(null);
    if (partial.index === currentIndex) return;

    // Submits the actual claim-answer form (not a bare navigation) so
    // whatever's filled in on the current claim gets saved - even if
    // incomplete - before jumping away, instead of silently discarding it.
    const form = document.getElementById("internal-audit-claim-form") as HTMLFormElement | null;
    const input = document.getElementById("jump_to_index_input") as HTMLInputElement | null;
    if (!form || !input) return;
    input.value = String(partial.index);
    form.requestSubmit();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
      <input
        list="wo-search-list"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search work order or claim #..."
        className="w-64 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
      />
      <datalist id="wo-search-list">
        {items.map((it) => it.workOrderNo && <option key={`wo-${it.index}`} value={it.workOrderNo} />)}
        {items.map((it) => (
          <option key={`cn-${it.index}`} value={it.claimNumber} />
        ))}
      </datalist>
      <button
        type="submit"
        className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50"
      >
        Go to claim
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}
