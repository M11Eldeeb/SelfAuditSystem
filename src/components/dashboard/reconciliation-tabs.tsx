"use client";

import { useState } from "react";
import { ReconciliationSection } from "@/components/dashboard/sections/reconciliation";
import { RejectedReviewSection } from "@/components/dashboard/sections/rejected-review";
import { ClaimsVsInvoicing } from "@/components/dashboard/sections/claims-vs-invoicing";
import { TrackedClaimsSection } from "@/components/dashboard/sections/tracked-claims";

export type ReconciliationView = "settlement" | "rejected" | "invoicing" | "tracked";

/** Reconciliation tabs: settled claims per settlement number, SAIC-rejected claims to review within 30 days, claims vs warranty invoicing discrepancies, and claims the officer tracks. */
export function ReconciliationTabs({ initialView = "settlement", ...props }: { settlementOrders: string[]; branches: { id: string; name: string }[]; currency: string; initialView?: ReconciliationView }) {
  const [view, setView] = useState<ReconciliationView>(initialView);
  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-xl bg-[#f5f5f7] p-1 text-sm font-semibold ring-1 ring-black/[0.05]">
        {(
          [
            ["settlement", "Settled claims"],
            ["rejected", "Rejected claims"],
            ["invoicing", "Claims vs invoicing"],
            ["tracked", "Claims to review"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setView(k)} className={`flex-1 rounded-lg px-3 py-1.5 ${view === k ? "bg-white text-[#1d1d1f] shadow-sm" : "text-[#6e6e73] hover:text-[#1d1d1f]"}`}>
            {label}
          </button>
        ))}
      </div>
      {view === "settlement" ? (
        <ReconciliationSection {...props} />
      ) : view === "rejected" ? (
        <RejectedReviewSection currency={props.currency} />
      ) : view === "invoicing" ? (
        <ClaimsVsInvoicing branches={props.branches} currency={props.currency} />
      ) : (
        <TrackedClaimsSection currency={props.currency} />
      )}
    </div>
  );
}

