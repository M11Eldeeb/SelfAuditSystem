"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deletePartReturn } from "./actions";

export function DeleteRequestButton({ requestId, label, status }: { requestId: string; label: string; status: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const remove = () => {
    const warning =
      status === "open"
        ? `Delete ${label}? The branch hasn't acted on it yet.`
        : `Delete ${label}? The branch has already acted on it - its waybill, missing-part justifications and any deduction tracker entries will be deleted too. This can't be undone.`;
    if (!window.confirm(warning)) return;
    startTransition(async () => {
      const res = await deletePartReturn(requestId);
      if (res.error) window.alert(res.error);
      else router.refresh();
    });
  };

  return (
    <button type="button" onClick={remove} disabled={isPending} className="text-sm font-medium text-red-600 hover:text-red-800 disabled:opacity-50">
      {isPending ? "Deleting…" : "Delete"}
    </button>
  );
}
