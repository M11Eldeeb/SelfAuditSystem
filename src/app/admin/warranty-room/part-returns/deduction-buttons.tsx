"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setDeduction } from "./actions";

export function DeductionButtons({
  itemId,
  status,
  deductedAt,
}: {
  itemId: string;
  status: "none" | "pending" | "deducted";
  deductedAt: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const set = (next: "none" | "pending" | "deducted", confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setError(null);
    startTransition(async () => {
      const res = await setDeduction(itemId, next);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-1">
      {status === "deducted" ? (
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
            Deducted {deductedAt ? new Date(deductedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Riyadh" }) : ""}
          </span>
          <button type="button" disabled={isPending} onClick={() => set("pending")} className="text-xs text-neutral-500 hover:text-neutral-800 disabled:opacity-50">
            Undo
          </button>
        </div>
      ) : status === "pending" ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={() => set("deducted")}
            className="rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
          >
            Mark deducted
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => set("none", "Waive the deduction for this part?")}
            className="text-xs text-neutral-500 hover:text-neutral-800 disabled:opacity-50"
          >
            Waive
          </button>
        </div>
      ) : (
        <span className="text-xs text-neutral-400">Waived</span>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
