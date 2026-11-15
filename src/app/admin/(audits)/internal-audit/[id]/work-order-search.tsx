"use client";

import { useState } from "react";

type SearchItem = { index: number; workOrderNo: string | null; claimNumber: string; vin?: string | null; serial?: string | null };

/** Letters and digits only, lower case - so "HER 12345", "her-12345" and "HER12345" all match. */
const norm = (v: string | null | undefined) => (v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const keys = (it: SearchItem) => [it.workOrderNo, it.claimNumber, it.vin, it.serial].map(norm).filter(Boolean);

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
    const q = norm(value);
    if (!q) return;

    // Work order, claim number, VIN or part serial number: an exact match first, else one that contains what was typed
    // (the last digits of a VIN or serial are enough).
    const exact = items.find((it) => keys(it).includes(q));
    const partial = exact ?? items.find((it) => keys(it).some((k) => k.includes(q)));

    if (!partial) {
      setError("No claim in this audit matches that work order, claim number, VIN or serial number.");
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
        placeholder="Work order, claim #, VIN or serial…"
        className="w-72 rounded-lg border border-neutral-300 bg-white shadow-sm transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none px-3 py-1.5 text-sm"
      />
      <datalist id="wo-search-list">
        {items.map((it) => it.workOrderNo && <option key={`wo-${it.index}`} value={it.workOrderNo} />)}
        {items.map((it) => (
          <option key={`cn-${it.index}`} value={it.claimNumber} />
        ))}
        {items.map((it) => it.vin && <option key={`vin-${it.index}`} value={it.vin} />)}
        {items.map((it) => it.serial && <option key={`sn-${it.index}`} value={it.serial} />)}
      </datalist>
      <button
        type="submit"
        className="rounded-lg border border-neutral-300 bg-white shadow-sm transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50"
      >
        Go to claim
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}
