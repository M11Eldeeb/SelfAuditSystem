"use client";

import { useState } from "react";

/** A value shown as a tap-to-copy chip (copies `value`, shows `label` if given). */
export function CopyText({ value, label, mono = false }: { value: string; label?: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // clipboard blocked - the text is still selectable
        }
      }}
      title="Copy"
      className={`inline-flex items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-1 text-sm text-neutral-900 select-all hover:bg-neutral-200 ${mono ? "font-mono tracking-wide" : ""}`}
    >
      {label ?? value}
      <span className={`text-[11px] font-semibold ${copied ? "text-emerald-700" : "text-neutral-500"}`}>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
