"use client";

import { useState, useTransition } from "react";
import { deleteInternalAudit } from "./actions";

export function DeleteInternalAuditButton({ auditId }: { auditId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    if (!window.confirm("Delete this internal audit? This can't be undone.")) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteInternalAudit(auditId);
      if (result.error) setError(result.error);
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
      >
        {isPending ? "Deleting..." : "Delete"}
      </button>
      {error && <p className="max-w-[220px] text-right text-xs text-red-600">{error}</p>}
    </div>
  );
}
