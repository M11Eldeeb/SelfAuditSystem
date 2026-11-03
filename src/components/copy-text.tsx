"use client";

import { useState } from "react";

/**
 * A value (claim number, VIN, work order, WIP...) with a small copy button next to it. The text itself can still be
 * selected; the button copies it in one click (works inside links and clickable rows too).
 */
export function CopyText({ value, className = "", label }: { value: string | null | undefined; className?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className={className}>—</span>;
  async function copy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value!);
    } catch {
      const t = document.createElement("textarea");
      t.value = value!;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span className="select-all">{value}</span>
      <button
        type="button"
        onClick={copy}
        title={copied ? "Copied" : `Copy ${label ?? value}`}
        aria-label={copied ? "Copied" : `Copy ${label ?? value}`}
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded transition ${copied ? "text-emerald-600" : "text-neutral-400 hover:bg-neutral-900/[0.06] hover:text-neutral-700"}`}
      >
        {copied ? (
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 8.5l3 3 7-7" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
            <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
            <path d="M10.5 5.5V3.5A1.5 1.5 0 009 2H3.5A1.5 1.5 0 002 3.5V9a1.5 1.5 0 001.5 1.5h2" />
          </svg>
        )}
      </button>
    </span>
  );
}
