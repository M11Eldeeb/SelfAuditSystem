"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closePartReturn, deletePartReturn } from "../actions";

const input =
  "block w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none";

export function OfficerRequestActions({ requestId, status, itemIds }: { requestId: string; status: string; itemIds: string[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ invoiceNo: "", shippingCompany: "", oemWaybill: "" });

  const close = () => {
    setError(null);
    startTransition(async () => {
      const res = await closePartReturn(requestId, form);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  };

  const remove = () => {
    if (!window.confirm("Withdraw this request? The branch hasn't acted on it yet.")) return;
    startTransition(async () => {
      const res = await deletePartReturn(requestId);
      if (res.error) setError(res.error);
      else router.push("/admin/part-returns");
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <a
          href={`/admin/part-returns/${requestId}/print?items=${itemIds.join(",")}`}
          target="_blank"
          className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 shadow-sm hover:bg-neutral-50"
        >
          Print claims & parts
        </a>
        {status === "open" && (
          <button type="button" onClick={remove} disabled={isPending} className="text-sm font-medium text-red-600 hover:text-red-800 disabled:opacity-50">
            Withdraw request
          </button>
        )}
      </div>

      {status === "dispatched" && (
        <div className="space-y-3 rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
          <div>
            <h2 className="font-semibold text-neutral-900">Received - send to manufacturer</h2>
            <p className="text-sm text-neutral-600">Once the parts are on their way to the manufacturer, record the shipment and close the request.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["invoiceNo", "Invoice number"],
                ["shippingCompany", "Shipping company"],
                ["oemWaybill", "Waybill number (to manufacturer)"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="space-y-1">
                <span className="text-xs font-medium text-neutral-700">{label}</span>
                <input value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} className={input} />
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={close}
            disabled={isPending}
            className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:opacity-50"
          >
            {isPending ? "Closing…" : "Close request"}
          </button>
        </div>
      )}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
