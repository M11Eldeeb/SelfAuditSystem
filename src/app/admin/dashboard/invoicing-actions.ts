"use server";

import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getInvoicingConnection } from "@/lib/invoicing/gmail-reader";
import { importLatestInvoicingReport, type ImportResult } from "@/lib/invoicing/import";

export type InvoicingLine = {
  d: string | null; // invoice date
  s: "labor" | "parts";
  b: string; // branch code
  bn: string; // branch name
  ac: string; // account code
  an: string; // account name
  op: string; // owing operator
  t: string; // sales type
  dp: string; // department
  a: number; // amount (SAR)
  n: number; // lines
};

export type InvoicingData = {
  connectedAs: string | null;
  lastImport: { fileName: string | null; subject: string | null; receivedAt: string | null; importedAt: string } | null;
  months: string[];
  month: string | null;
  lines: InvoicingLine[];
};

/** Officer only: the summed report lines of one month (default: the newest month there is data for). */
export async function getInvoicingData(month?: string | null): Promise<InvoicingData> {
  await requireRole("officer");
  const admin = createAdminClient();
  const [connection, { data: last }, { data: monthRows }] = await Promise.all([
    getInvoicingConnection(),
    admin.from("self_audit_invoicing_imports").select("file_name, subject, received_at, imported_at").order("imported_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("self_audit_invoicing_imports").select("months").order("imported_at", { ascending: false }).limit(60),
  ]);
  const months = [...new Set((monthRows ?? []).flatMap((r) => r.months))].sort().reverse();
  const chosen = month && months.includes(month) ? month : (months[0] ?? null);

  const lines: InvoicingLine[] = [];
  if (chosen) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin
        .from("self_audit_invoicing_lines")
        .select("invoice_date, source, branch, branch_name, account_code, account_name, owing_operator, sales_type, department, amount, lines")
        .eq("month", chosen)
        .order("id")
        .range(from, from + 999);
      if (error || !data?.length) break;
      for (const r of data)
        lines.push({ d: r.invoice_date, s: r.source, b: r.branch, bn: r.branch_name, ac: r.account_code, an: r.account_name, op: r.owing_operator, t: r.sales_type, dp: r.department, a: Number(r.amount), n: r.lines });
      if (data.length < 1000) break;
    }
  }
  return {
    connectedAs: connection?.accountEmail ?? null,
    lastImport: last ? { fileName: last.file_name, subject: last.subject, receivedAt: last.received_at, importedAt: last.imported_at } : null,
    months,
    month: chosen,
    lines,
  };
}

/** The Refresh button (and the page itself when the data is old): read the newest report e-mail now. */
export async function refreshInvoicing(force = false): Promise<ImportResult> {
  const officer = await requireRole("officer");
  return importLatestInvoicingReport({ force, userId: officer.id });
}

export type InvoicingFilter = { type?: string; account?: string; branch?: string; operator?: string; source?: "labor" | "parts"; day?: string; department?: string };

/** Invoiced work orders (distinct WIPs) and line count for the current filters. */
export async function getInvoicingCounts(month: string, f: InvoicingFilter): Promise<{ workOrders: number; lines: number }> {
  await requireRole("officer");
  const supabase = await createClient();
  const { data } = await supabase.rpc("invoicing_counts", { p_month: month, p_type: f.type ?? "", p_account: f.account ?? "", p_branch: f.branch ?? "", p_operator: f.operator ?? "" });
  return { workOrders: Number(data?.[0]?.work_orders ?? 0), lines: Number(data?.[0]?.lines ?? 0) };
}

export type InvoicingDetailRow = {
  date: string | null;
  source: "labor" | "parts";
  branch: string;
  account: string;
  accountName: string;
  operator: string;
  type: string;
  department: string;
  wip: string;
  invoice: string;
  vin: string;
  item: string;
  description: string;
  customer: string;
  qty: number | null;
  amount: number;
};

const DETAIL_PAGE = 200;

/** The report lines behind a visual: the dashboard's filters plus what was clicked, biggest amounts first. */
export async function getInvoicingDetails(month: string, f: InvoicingFilter, page = 0): Promise<{ rows: InvoicingDetailRow[]; total: number; pageSize: number }> {
  await requireRole("officer");
  let q = createAdminClient()
    .from("self_audit_invoicing_detail")
    .select("invoice_date, source, branch, account_code, account_name, owing_operator, sales_type, department, wip, invoice_no, vin, item, description, customer, qty, amount", { count: "exact" })
    .eq("month", month);
  if (f.type) q = q.eq("sales_type", f.type);
  if (f.account) q = q.eq("account_code", f.account);
  if (f.branch) q = q.eq("branch", f.branch);
  if (f.operator) q = q.eq("owing_operator", f.operator);
  if (f.source) q = q.eq("source", f.source);
  if (f.day) q = q.eq("invoice_date", f.day);
  if (f.department) q = q.eq("department", f.department);
  const { data, count } = await q.order("amount", { ascending: false }).range(page * DETAIL_PAGE, page * DETAIL_PAGE + DETAIL_PAGE - 1);
  return {
    total: count ?? 0,
    pageSize: DETAIL_PAGE,
    rows: (data ?? []).map((r) => ({
      date: r.invoice_date,
      source: r.source,
      branch: r.branch,
      account: r.account_code,
      accountName: r.account_name,
      operator: r.owing_operator,
      type: r.sales_type,
      department: r.department,
      wip: r.wip,
      invoice: r.invoice_no,
      vin: r.vin,
      item: r.item,
      description: r.description,
      customer: r.customer,
      qty: r.qty == null ? null : Number(r.qty),
      amount: Number(r.amount),
    })),
  };
}
