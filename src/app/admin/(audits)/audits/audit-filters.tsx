"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

type Branch = { id: string; name: string };

/** Opens/closes one popover and closes it on outside click or Escape. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

const chip =
  "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
const chipIdle = "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50";
const chipActive = "border-brand/30 bg-brand/10 text-brand";

const popoverBase =
  "absolute left-0 z-30 mt-2 origin-top-left rounded-xl border border-neutral-200 bg-white p-3 text-neutral-900 shadow-xl shadow-black/15 transition duration-150 ease-out motion-reduce:transition-none";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 text-neutral-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
    >
      <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Branch filter for the Audits overview, as one compact toolbar. The URL stays
 * the single source of truth (?branch=..&branch=..) so the server page just
 * reads it; the picker applies with its Apply button.
 */
export function AuditFilters({ branches, selected }: { branches: Branch[]; selected: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const go = (ids: string[]) => {
    const p = new URLSearchParams();
    ids.forEach((b) => p.append("branch", b));
    const qs = p.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  return (
    <div
      role="toolbar"
      aria-label="Overview filters"
      aria-busy={isPending}
      className={`flex flex-wrap items-center gap-2 transition-opacity ${isPending ? "opacity-70" : ""}`}
    >
      <BranchFilter branches={branches} selected={selected} onApply={go} />
      {selected.length > 0 && (
        <button
          type="button"
          onClick={() => go([])}
          className="h-9 rounded-lg px-2.5 text-sm font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800"
        >
          Reset
        </button>
      )}
      {isPending && <span className="text-xs text-neutral-500">Updating…</span>}
    </div>
  );
}

function BranchFilter({ branches, selected, onApply }: { branches: Branch[]; selected: string[]; onApply: (ids: string[]) => void }) {
  const { open, setOpen, ref } = usePopover();
  const [draft, setDraft] = useState<string[]>(selected);
  const [query, setQuery] = useState("");

  const visible = useMemo(() => branches.filter((b) => b.name.toLowerCase().includes(query.trim().toLowerCase())), [branches, query]);
  const changed = draft.length !== selected.length || draft.some((id) => !selected.includes(id));

  const label =
    selected.length === 0
      ? "All branches"
      : selected.length === 1
        ? (branches.find((b) => b.id === selected[0])?.name ?? "1 branch")
        : `${selected.length} branches`;

  const toggle = (id: string) => setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));
  const close = () => setOpen(false);
  const apply = () => {
    if (changed) onApply(draft);
    close();
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (!open) {
            setDraft(selected);
            setQuery("");
          }
          setOpen(!open);
        }}
        className={`${chip} ${selected.length > 0 ? chipActive : chipIdle}`}
      >
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M3 17V7l7-4 7 4v10M7 17v-5h6v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="max-w-[10rem] truncate">{label}</span>
        <Chevron open={open} />
      </button>

      <div
        role="dialog"
        aria-label="Choose branches"
        inert={!open}
        className={`${popoverBase} w-64 ${open ? "translate-y-0 scale-100 opacity-100" : "pointer-events-none -translate-y-1 scale-95 opacity-0"}`}
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search branches"
          aria-label="Search branches"
          className="mb-2 h-8 w-full rounded-md border border-neutral-300 bg-white px-2.5 text-sm text-neutral-900 placeholder:text-neutral-500 focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
        />
        <ul className="max-h-56 space-y-0.5 overflow-y-auto">
          {visible.map((b) => {
            const on = draft.includes(b.id);
            return (
              <li key={b.id}>
                <label className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors ${on ? "bg-brand/10 text-neutral-900" : "text-neutral-700 hover:bg-neutral-100"}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(b.id)} className="accent-brand" />
                  {b.name}
                </label>
              </li>
            );
          })}
          {visible.length === 0 && <li className="px-2 py-3 text-center text-sm text-neutral-500">No branch matches.</li>}
        </ul>
        <div className="mt-2 flex items-center justify-between border-t border-neutral-100 pt-2">
          <button type="button" onClick={() => setDraft([])} disabled={draft.length === 0} className="text-xs font-medium text-neutral-500 hover:text-neutral-800 disabled:opacity-40">
            Clear
          </button>
          <button
            type="button"
            onClick={apply}
            className="rounded-md bg-brand px-3 py-1 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-brand-dark"
          >
            {changed ? "Apply" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}
