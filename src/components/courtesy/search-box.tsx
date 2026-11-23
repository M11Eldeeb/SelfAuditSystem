"use client";

import { useState } from "react";

/**
 * Instant search over a list drawn by the server: every row inside `#target` that carries `data-q` (its searchable text)
 * is hidden when it does not contain all the words typed. Arabic or English, digits in either script.
 */
export function SearchBox({ target, placeholder = "Search" }: { target: string; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [count, setCount] = useState<{ shown: number; all: number } | null>(null);
  const apply = (value: string) => {
    setQ(value);
    const words = value
      .replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c)))
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const rows = Array.from(document.querySelectorAll<HTMLElement>(`#${target} [data-q]`));
    let shown = 0;
    for (const r of rows) {
      const ok = words.every((w) => (r.dataset.q ?? "").toLowerCase().includes(w));
      r.hidden = !ok;
      if (ok) shown++;
    }
    setCount(words.length ? { shown, all: rows.length } : null);
  };
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-neutral-400" aria-hidden="true">
        ⌕
      </span>
      <input
        type="search"
        value={q}
        onChange={(e) => apply(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-xl border border-neutral-300 bg-white py-2.5 pr-24 pl-9 text-sm shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
      />
      {count && <span className="absolute top-1/2 right-3 -translate-y-1/2 text-xs text-neutral-500">{count.shown} of {count.all}</span>}
    </div>
  );
}
