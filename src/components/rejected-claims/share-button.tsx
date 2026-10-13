"use client";

import { useState, useTransition } from "react";
import { shareDriveWithOfficers } from "@/app/actions/rejected-claims";

/** Gives every officer view access to the Drive folder (safe to press again when a new officer joins). */
export function ShareButton() {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    setMessage(null);
    startTransition(async () => {
      const res = await shareDriveWithOfficers();
      if (res.error || !res.result) {
        setMessage({ ok: false, text: res.error ?? "Could not share the folder." });
        return;
      }
      const { shared, already, failed } = res.result;
      const parts = [
        shared.length > 0 ? `Shared with ${shared.length} officer${shared.length === 1 ? "" : "s"} (${shared.join(", ")}).` : "",
        already.length > 0 ? `${already.length} already had access.` : "",
        failed.length > 0 ? `Could not share with ${failed.map((f) => `${f.email} (${f.reason})`).join("; ")}.` : "",
      ].filter(Boolean);
      setMessage({ ok: failed.length === 0, text: parts.join(" ") || "There is nobody else to share with." });
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 disabled:opacity-60"
      >
        {pending ? "Sharing..." : "Share with officers"}
      </button>
      {message && (
        <p role="status" className={`max-w-sm text-right text-xs ${message.ok ? "text-emerald-700" : "text-red-600"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
