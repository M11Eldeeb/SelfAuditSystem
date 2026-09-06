"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SearchItem = { index: number; workOrderNo: string | null; claimNumber: string };

export function WorkOrderSearch({
  auditId,
  mode,
  items,
}: {
  auditId: string;
  mode: string;
  items: SearchItem[];
}) {
  const router = useRouter();
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
    router.push(`/admin/internal-audit/${auditId}?claim=${partial.index}&mode=${mode}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
      <input
        list={`wo-search-list-${auditId}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search work order or claim #..."
        className="w-64 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
      />
      <datalist id={`wo-search-list-${auditId}`}>
        {items.map(
          (it) => it.workOrderNo && <option key={it.index} value={it.workOrderNo} />
        )}
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
