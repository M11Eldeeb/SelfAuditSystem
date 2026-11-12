"use client";

import { useEffect, useState } from "react";
import { getRejectedBatchSummary, type RejectedBatchSummary } from "@/app/admin/dashboard/rejected-review-actions";
import { C, StackedBar } from "@/components/dashboard/charts";
import { Card, Label, Metric, Pill, fmtInt, fmtMoney } from "@/components/dashboard/ui";

/** Claims & Financials: the claims of the batch that SAIC rejected - how many are solved and how many are left. */
export function RejectedBatchCard({ branchIds, currency }: { branchIds: string[]; currency: string }) {
  const key = branchIds.join(",");
  const [res, setRes] = useState<{ key: string; data: RejectedBatchSummary | null } | null>(null);
  useEffect(() => {
    let live = true;
    getRejectedBatchSummary(branchIds).then(
      (data) => live && setRes({ key, data }),
      () => live && setRes({ key, data: null })
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const d = res?.key === key ? res.data : null;
  const loading = res?.key !== key;
  return (
    <Card accent={C.red} className="flex flex-col justify-between gap-3">
      <div className="flex items-center justify-between">
        <Label>Rejected claims</Label>
        <Pill tone="muted">claims batch</Pill>
      </div>
      {loading ? (
        <p className="text-sm text-[#6e6e73]">Loading…</p>
      ) : !d ? (
        <p className="text-sm text-[#b10012]">Could not load the rejected claims.</p>
      ) : (
        <>
          <div>
            <Metric value={fmtInt(d.total)} unit="rejected" />
            <div className="text-xs text-[#6e6e73]">
              {fmtMoney(d.amountTotal)} {currency} · all periods
            </div>
          </div>
          <div>
            <StackedBar
              legend={false}
              height="h-3"
              segments={[
                { label: "Solved", value: d.solved, color: C.green },
                { label: "Left", value: d.left, color: C.red },
              ]}
            />
            <div className="mt-1.5 grid grid-cols-2 text-center">
              <div>
                <div className="text-[11px] font-bold text-[#6e6e73] uppercase">Solved</div>
                <div className="text-sm font-bold text-emerald-700">{fmtInt(d.solved)}</div>
              </div>
              <div>
                <div className="text-[11px] font-bold text-[#6e6e73] uppercase">Left</div>
                <div className="text-sm font-bold text-[#9a000d]">{fmtInt(d.left)}</div>
              </div>
            </div>
          </div>
          {d.left > 0 && (
            <div className="text-xs text-[#6e6e73]">
              Left: {fmtInt(d.notReviewed)} not reviewed · {fmtInt(d.appealSubmitted)} appeal submitted · {fmtInt(d.confirmedRejection)} confirmed rejection · {fmtMoney(d.amountLeft)} {currency}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
