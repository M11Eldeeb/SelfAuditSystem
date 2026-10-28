"use server";

import { requireAnyViewer } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/** At least this many months on the month charts, whatever range is picked. */
const MIN_MONTHS = 5;
/** The invoicing report's branch codes -> the portal's (P7 "Riyadh Quick Service" has no portal branch: counted for all branches only). */
const REPORT_BRANCH: Record<string, string> = { A7: "HER", B7: "MRB", C7: "RSS", E7: "RNQ", F7: "QSM", G7: "DMM", I7: "NKH", J7: "MAD", K7: "JZN" };
const SAR_PER_USD = 3.75;

export type FinanceMonth = {
  month: string;
  claims: number;
  claimed: number;
  adjusted: number;
  submittedClaims: number;
  submitted: { labor: number; parts: number; sublet: number; total: number };
  /** The same split for claims by repair end date (closer to the invoice date). */
  repaired: { labor: number; parts: number; sublet: number; total: number };
  /** Warranty invoicing (sales type Warranty) - null when no report was imported for the month. */
  invoiced: { labor: number; parts: number; total: number } | null;
};

const shift = (yyyyMM: string, n: number) => {
  const [y, m] = yyyyMM.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

/**
 * Claims & Financials month charts: claimed vs adjusted (repair end date) and submitted claims (first submit date) vs
 * warranty invoiced, labor / parts / sublet, for the picked range stretched to at least 5 months. Money in the claims'
 * currency (USD): the invoicing report is in SAR and is converted at 3.75.
 */
export async function getFinanceMonthly(input: { from: string; to: string; branchIds: string[]; exactRange?: boolean }): Promise<{ months: FinanceMonth[]; partialInvoicing: boolean }> {
  const user = await requireAnyViewer(["officer", "branch_admin"]);
  const admin = createAdminClient();
  const end = /^\d{4}-\d{2}$/.test(input.to) ? input.to : new Date().toISOString().slice(0, 7);
  const asked = /^\d{4}-\d{2}$/.test(input.from) ? input.from : end;
  const start = input.exactRange || asked < shift(end, -(MIN_MONTHS - 1)) ? asked : shift(end, -(MIN_MONTHS - 1));

  const { data: branches } = await admin.from("self_audit_branches").select("id, code, active");
  let ids = input.branchIds.length ? input.branchIds : (branches ?? []).filter((b) => b.active).map((b) => b.id);
  if (user.role !== "officer") ids = user.branch_id ? [user.branch_id] : [];
  const codes = new Set((branches ?? []).filter((b) => ids.includes(b.id)).map((b) => b.code));
  const allActive = (branches ?? []).filter((b) => b.active).every((b) => ids.includes(b.id));

  const [{ data: series }, { data: lines }] = await Promise.all([
    admin.rpc("claims_month_series", { p_branches: ids, p_from: `${start}-01`, p_to: `${shift(end, 1)}-01` }),
    admin.from("self_audit_invoicing_lines").select("month, source, branch, amount").eq("sales_type", "Warranty").gte("month", `${start}-01`).lte("month", `${end}-01`).limit(20000),
  ]);

  const months: FinanceMonth[] = [];
  for (let m = start; m <= end; m = shift(m, 1)) months.push({ month: m, claims: 0, claimed: 0, adjusted: 0, submittedClaims: 0, submitted: { labor: 0, parts: 0, sublet: 0, total: 0 }, repaired: { labor: 0, parts: 0, sublet: 0, total: 0 }, invoiced: null });
  const at = new Map(months.map((m) => [m.month, m]));
  for (const r of series ?? []) {
    const m = at.get(r.month);
    if (!m) continue;
    if (r.kind === "repair") {
      m.claims = Number(r.claims);
      m.claimed = Number(r.claimed ?? 0);
      m.adjusted = Number(r.adjusted ?? 0);
      m.repaired = { labor: Number(r.labor ?? 0), parts: Number(r.parts ?? 0), sublet: Number(r.sublet ?? 0), total: Number(r.claimed ?? 0) };
    } else {
      m.submittedClaims = Number(r.claims);
      m.submitted = { labor: Number(r.labor ?? 0), parts: Number(r.parts ?? 0), sublet: Number(r.sublet ?? 0), total: Number(r.claimed ?? 0) };
    }
  }
  // Months with an imported report show 0 for a branch with no warranty lines (not "not imported").
  for (const l of lines ?? []) {
    const m = at.get(String(l.month).slice(0, 7));
    if (m) m.invoiced ??= { labor: 0, parts: 0, total: 0 };
  }
  for (const l of lines ?? []) {
    const m = at.get(String(l.month).slice(0, 7));
    if (!m) continue;
    // A branch view counts only that branch's report lines; the all-branches view counts every line.
    if (!allActive && !codes.has(REPORT_BRANCH[l.branch] ?? "")) continue;
    m.invoiced ??= { labor: 0, parts: 0, total: 0 };
    const usd = Number(l.amount) / SAR_PER_USD;
    if (l.source === "labor") m.invoiced.labor += usd;
    else m.invoiced.parts += usd;
    m.invoiced.total += usd;
  }
  return { months, partialInvoicing: months.some((m) => !m.invoiced) };
}
