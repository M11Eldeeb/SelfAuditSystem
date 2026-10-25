"use client";

import { useEffect, useState } from "react";
import { getInvoicingDetails, getInvoicingExport, type InvoicingDetailRow, type InvoicingFilter } from "@/app/admin/dashboard/invoicing-actions";
import { downloadXlsx, LINE_COLUMNS } from "./invoicing-export";
import { Sar } from "@/components/dashboard/riyal";

export type Drill = { title: string; filter: InvoicingFilter; total?: number };

const usd = (sar: number) => `$${(sar / 3.75).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** "Show me the data": the report lines behind a clicked visual, biggest amounts first, 200 per page. */
export function InvoicingDrill({ month, drill, onClose, onFilter }: { month: string; drill: Drill; onClose: () => void; onFilter?: () => void }) {
  const [page, setPage] = useState(0);
  const [state, setState] = useState<{ rows: InvoicingDetailRow[]; total: number; pageSize: number; page: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  async function exportAll() {
    setExporting(true);
    try {
      await downloadXlsx(`${drill.title.slice(0, 120)}.xlsx`, "Lines", LINE_COLUMNS, await getInvoicingExport(month, drill.filter));
    } catch {
      setError("The export failed - please try again.");
    } finally {
      setExporting(false);
    }
  }
  const loading = !state || state.page !== page;

  useEffect(() => {
    let alive = true;
    getInvoicingDetails(month, drill.filter, page).then(
      (r) => alive && setState({ ...r, page }),
      () => alive && setError("Could not load the lines - please try again.")
    );
    return () => {
      alive = false;
    };
  }, [month, drill, page]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pages = state ? Math.max(1, Math.ceil(state.total / state.pageSize)) : 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-6" onClick={onClose} role="dialog" aria-modal="true" aria-label={drill.title}>
      <div className="flex max-h-full w-full max-w-7xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="font-display text-lg font-semibold text-slate-900">{drill.title}</h3>
            <p className="text-xs text-slate-500">
              {state ? `${state.total.toLocaleString("en-US")} lines` : "Loading..."}
              {drill.total != null && (
                <>
                  {" · "}
                  <Sar value={drill.total} /> · {usd(drill.total)}
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void exportAll()} disabled={exporting || !state?.total} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40">
              {exporting ? "Exporting..." : "Export to Excel"}
            </button>
            {onFilter && (
              <button type="button" onClick={onFilter} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50">
                Filter the dashboard by this
              </button>
            )}
            <button type="button" onClick={onClose} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">
              Close
            </button>
          </div>
        </div>
        {error && <p className="m-4 rounded-lg bg-[#ffdad6] px-3 py-2 text-sm text-[#93000a]">{error}</p>}
        <div className={`min-h-0 flex-1 overflow-auto transition-opacity ${loading ? "opacity-50" : ""}`}>
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 text-left text-[11px] font-bold tracking-wide text-slate-500 uppercase">
              <tr>
                {["Date", "Type", "Branch", "WIP", "Invoice", "Account", "Owing operator", "Sales type", "Department", "VIN", "Code", "Description", "Customer", "Qty", "Amount (SAR)"].map((h) => (
                  <th key={h} className={`px-2 py-2 whitespace-nowrap ${h === "Qty" || h.startsWith("Amount") ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {state?.rows.map((r, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-2 py-1.5 whitespace-nowrap">{r.date}</td>
                  <td className="px-2 py-1.5">{r.source === "labor" ? "Labor" : "Parts"}</td>
                  <td className="px-2 py-1.5">{r.branch}</td>
                  <td className="px-2 py-1.5 font-mono select-all">{r.wip}</td>
                  <td className="px-2 py-1.5 font-mono select-all">{r.invoice}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap" title={r.accountName}>
                    {r.account}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{r.operator}</td>
                  <td className="px-2 py-1.5">{r.type}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{r.department}</td>
                  <td className="px-2 py-1.5 font-mono select-all">{r.vin}</td>
                  <td className="px-2 py-1.5 font-mono">{r.item}</td>
                  <td className="max-w-[16rem] truncate px-2 py-1.5" title={r.description}>
                    {r.description}
                  </td>
                  <td className="max-w-[12rem] truncate px-2 py-1.5" title={r.customer}>
                    {r.customer}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.qty ?? ""}</td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{r.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              ))}
              {state && state.rows.length === 0 && (
                <tr>
                  <td colSpan={15} className="py-8 text-center text-sm text-slate-500">
                    No lines.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-2 text-xs">
            <button type="button" disabled={page === 0 || loading} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-slate-300 px-2.5 py-1 disabled:opacity-40">
              Previous
            </button>
            <span className="text-slate-500">
              Page {page + 1} of {pages}
            </span>
            <button type="button" disabled={page >= pages - 1 || loading} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-slate-300 px-2.5 py-1 disabled:opacity-40">
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
