import type { DashboardData } from "@/lib/dashboard/kpis";
import { RECON_FROM_ORDER, isOnOrAfterReconStart, settlementDate } from "@/lib/dashboard/recon-constants";
import { C, Meter, StackedBar } from "@/components/dashboard/charts";
import { Label, Panel, Pill, fmtInt, fmtNum } from "@/components/dashboard/ui";

/**
 * Reconciliation progress since RECON_FROM_ORDER: settled claims SAIC paid
 * short, how many (and how much) have been reviewed vs are still pending.
 */
export function ReconProgress({ data, onOpen }: { data: DashboardData; onOpen?: () => void }) {
  const rows = data.reconciliation.filter((r) => isOnOrAfterReconStart(r.order));
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
  const lossCount = sum((r) => r.lossCount);
  const lossAmount = sum((r) => r.lossAmount);
  const reviewedCount = sum((r) => r.reviewedCount);
  const reviewedAmount = sum((r) => r.reviewedAmount);
  const pendingCount = lossCount - reviewedCount;
  const pendingAmount = lossAmount - reviewedAmount;
  const pct = lossAmount ? (reviewedAmount / lossAmount) * 100 : 0;

  return (
    <Panel
      eyebrow="Settlement reconciliation"
      title="Reviewed vs pending"
      subtitle={`Settled claims paid short by SAIC, settlement ${RECON_FROM_ORDER} (${settlementDate(RECON_FROM_ORDER)}) onward`}
      action={
        onOpen && (
          <button
            type="button"
            onClick={onOpen}
            className="rounded-lg bg-[#0b1c30] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#9a000d]"
          >
            Open reconciliation →
          </button>
        )
      }
    >
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-[#575e70]">No settled claims with a loss since {RECON_FROM_ORDER}.</p>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-lg bg-[#eff4ff] p-3">
              <Label>Total loss</Label>
              <div className="font-display text-xl font-bold text-[#0b1c30]">
                {fmtNum(lossAmount, 2)} <span className="text-xs font-semibold text-[#575e70]">{data.currency}</span>
              </div>
              <div className="text-[11px] text-[#575e70]">{fmtInt(lossCount)} claims</div>
            </div>
            <div className="rounded-lg bg-emerald-50 p-3">
              <Label className="text-emerald-700">Reviewed</Label>
              <div className="font-display text-xl font-bold text-emerald-700">{fmtNum(reviewedAmount, 2)}</div>
              <div className="text-[11px] text-[#575e70]">{fmtInt(reviewedCount)} claims</div>
            </div>
            <div className="rounded-lg bg-[#ffdad6]/50 p-3">
              <Label className="text-[#9a000d]">Pending</Label>
              <div className="font-display text-xl font-bold text-[#9a000d]">{fmtNum(pendingAmount, 2)}</div>
              <div className="text-[11px] text-[#575e70]">{fmtInt(pendingCount)} claims</div>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex flex-wrap justify-between gap-2 text-xs">
              <span className="font-semibold text-[#0b1c30]">{pct.toFixed(1)}% of the loss amount reviewed</span>
              <span className="text-[#575e70]">
                Reinvoiced {fmtNum(sum((r) => r.reinvoicedAmount), 2)} · Overdue {fmtNum(sum((r) => r.overdueAmount), 2)} · SAIC{" "}
                {fmtNum(sum((r) => r.saicAmount), 2)} · Internal {fmtNum(sum((r) => r.internalAmount), 2)} · GW {fmtNum(sum((r) => r.gwAmount), 2)}
              </span>
            </div>
            <StackedBar
              legend={false}
              height="h-3"
              segments={[
                { label: "Reviewed", value: reviewedAmount, color: C.green },
                { label: "Pending", value: pendingAmount, color: C.red },
              ]}
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#eff4ff] text-[10px] font-bold tracking-wider text-[#575e70] uppercase">
                <tr>
                  <th className="px-3 py-2">Settlement no.</th>
                  <th className="px-3 py-2 text-right">Claims</th>
                  <th className="px-3 py-2 text-right">Loss</th>
                  <th className="px-3 py-2 text-right">Reviewed</th>
                  <th className="px-3 py-2 text-right">Pending</th>
                  <th className="w-48 px-3 py-2">Progress</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5eeff] tabular-nums">
                {rows.map((r) => {
                  const p = r.lossAmount ? (r.reviewedAmount / r.lossAmount) * 100 : 0;
                  return (
                    <tr key={r.order} className="hover:bg-[#eff4ff]/50">
                      <td className="px-3 py-2">
                        <div className="font-semibold text-[#0b1c30]">{r.order}</div>
                        <div className="text-[10px] text-[#575e70]">{settlementDate(r.order)}</div>
                      </td>
                      <td className="px-3 py-2 text-right">{fmtInt(r.lossCount)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{fmtNum(r.lossAmount, 2)}</td>
                      <td className="px-3 py-2 text-right text-emerald-700">
                        {fmtInt(r.reviewedCount)} · {fmtNum(r.reviewedAmount, 2)}
                      </td>
                      <td className="px-3 py-2 text-right text-[#9a000d]">
                        {fmtInt(r.lossCount - r.reviewedCount)} · {fmtNum(r.lossAmount - r.reviewedAmount, 2)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Meter pct={p} color={p >= 99.995 ? C.green : p > 0 ? C.amber : C.red} height="h-1.5" />
                          {p >= 99.995 ? (
                            <Pill tone="good">Done</Pill>
                          ) : (
                            <span className="w-9 text-right text-[10px] text-[#575e70]">{Math.round(p)}%</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  );
}
