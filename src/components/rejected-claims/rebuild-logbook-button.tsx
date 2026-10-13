"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rebuildLogbook } from "@/app/actions/rejected-claims";

/** Officer-only: writes the logbook PDF to Drive again (e.g. if it is missing or out of date). */
export function RebuildLogbookButton({ entryId }: { entryId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await rebuildLogbook(entryId);
            if (res.error) setError(res.error);
            else router.refresh();
          });
        }}
        className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 disabled:opacity-60"
      >
        {pending ? "Rebuilding..." : "Rebuild logbook"}
      </button>
      {error && <span className="max-w-xs text-xs text-red-600">{error}</span>}
    </span>
  );
}
