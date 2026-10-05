import type { FinanceMonth } from "@/lib/dashboard/finance";
import { ColumnChart } from "@/components/dashboard/charts";

const cardClass = "rounded-xl border border-neutral-200/70 bg-white p-5 shadow-sm";

function fmtMoney(v: number): string {
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function FinanceReport({ months, currency }: { months: FinanceMonth[]; currency: string }) {
  const total = months.reduce((s, m) => s + m.totalAdjusted, 0);
  const count = months.reduce((s, m) => s + m.claimCount, 0);
  const chronological = [...months].reverse().slice(-12);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Outstanding claims</h1>
        <p className="text-sm text-neutral-600">
          Submitted claims not yet closed, settled or rejected, by first submit month.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className={cardClass}>
          <div className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Total claim adjusted ({currency})</div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-neutral-900 tabular-nums">{fmtMoney(total)}</div>
        </div>
        <div className={cardClass}>
          <div className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Claims</div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-neutral-900 tabular-nums">{count.toLocaleString("en-US")}</div>
        </div>
      </div>

      {chronological.length > 1 && (
        <section className={cardClass}>
          <h2 className="mb-4 text-base font-semibold text-neutral-900">Total claim adjusted by first submit month</h2>
          <ColumnChart
            points={chronological.map((m) => ({ label: m.month, value: m.totalAdjusted, tooltip: `${m.month}: ${fmtMoney(m.totalAdjusted)}` }))}
            format={(v) => v.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 })}
          />
        </section>
      )}

      <section className={`${cardClass} p-0`}>
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            <tr>
              <th className="px-5 py-2.5">First submit year-month</th>
              <th className="px-5 py-2.5 text-right">Claims</th>
              <th className="px-5 py-2.5 text-right">Total claim adjusted ({currency})</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 tabular-nums">
            {months.map((m) => (
              <tr key={m.month} className="hover:bg-neutral-50">
                <td className="px-5 py-2 font-medium text-neutral-900">{m.month}</td>
                <td className="px-5 py-2 text-right">{m.claimCount.toLocaleString("en-US")}</td>
                <td className="px-5 py-2 text-right">{fmtMoney(m.totalAdjusted)}</td>
              </tr>
            ))}
            {months.length === 0 && (
              <tr>
                <td colSpan={3} className="px-5 py-6 text-center text-neutral-500">
                  No outstanding claims.
                </td>
              </tr>
            )}
          </tbody>
          {months.length > 0 && (
            <tfoot className="border-t border-neutral-200 bg-neutral-50 font-semibold tabular-nums">
              <tr>
                <td className="px-5 py-2.5">Total</td>
                <td className="px-5 py-2.5 text-right">{count.toLocaleString("en-US")}</td>
                <td className="px-5 py-2.5 text-right">{fmtMoney(total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </section>
    </div>
  );
}
