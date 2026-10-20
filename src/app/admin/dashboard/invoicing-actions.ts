"use server";

import { requireRole, requireViewer } from "@/lib/auth";
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
  await requireViewer("officer");
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
  await requireViewer("officer");
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
  await requireViewer("officer");
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

const DETAIL_COLUMNS = "invoice_date, source, branch, account_code, account_name, owing_operator, sales_type, department, wip, invoice_no, vin, item, description, customer, qty, amount" as const;

/** Export: every line behind the current view (up to 30,000), in the same shape as the drill-down. */
export async function getInvoicingExport(month: string, f: InvoicingFilter): Promise<InvoicingDetailRow[]> {
  await requireViewer("officer");
  const out: InvoicingDetailRow[] = [];
  for (let from = 0; from < 30000; from += 1000) {
    let q = createAdminClient().from("self_audit_invoicing_detail").select(DETAIL_COLUMNS).eq("month", month);
    if (f.type) q = q.eq("sales_type", f.type);
    if (f.account) q = q.eq("account_code", f.account);
    if (f.branch) q = q.eq("branch", f.branch);
    if (f.operator) q = q.eq("owing_operator", f.operator);
    if (f.source) q = q.eq("source", f.source);
    if (f.day) q = q.eq("invoice_date", f.day);
    if (f.department) q = q.eq("department", f.department);
    const { data } = await q.order("id").range(from, from + 999);
    for (const r of data ?? [])
      out.push({
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
      });
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

/** Month totals (labor / parts, per department) for the trend chart - every month imported so far. */
export async function getInvoicingMonthly(f: InvoicingFilter): Promise<{ month: string; source: string; department: string; amount: number; lines: number }[]> {
  await requireViewer("officer");
  const supabase = await createClient();
  const { data } = await supabase.rpc("invoicing_monthly", { p_type: f.type ?? "", p_account: f.account ?? "", p_branch: f.branch ?? "", p_operator: f.operator ?? "" });
  return (data ?? []).map((r) => ({ month: String(r.month).slice(0, 10), source: r.source, department: r.department, amount: Number(r.amount), lines: Number(r.lines) }));
}

export type UnclaimedLine = InvoicingDetailRow & {
  key: string;
  mark: { status: "resolved" | "credit_note"; note: string | null; by: string | null; at: string } | null;
};

/** Warranty lines invoiced without a claim number (the month's lines, plus any marks made on them). */
export async function getUnclaimedWarranty(month: string): Promise<UnclaimedLine[]> {
  await requireViewer("officer");
  const admin = createAdminClient();
  const [{ data: lines }, { data: marks }] = await Promise.all([
    admin.from("self_audit_invoicing_detail").select(`${DETAIL_COLUMNS}, line_key`).eq("month", month).eq("sales_type", "Warranty").eq("claim_no", "").order("invoice_date").limit(2000),
    admin.from("self_audit_invoicing_unclaimed_marks").select("line_key, status, note, marked_by_name, marked_at").eq("month", month),
  ]);
  const markOf = new Map((marks ?? []).map((m) => [m.line_key, m]));
  return (lines ?? []).map((r) => {
    const m = markOf.get(r.line_key);
    return {
      key: r.line_key,
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
      mark: m ? { status: m.status, note: m.note, by: m.marked_by_name, at: m.marked_at } : null,
    };
  });
}

/** Marks warranty lines without a claim number as resolved or credit note (a copy of each line is kept with the mark). */
export async function markUnclaimed(month: string, keys: string[], status: "resolved" | "credit_note", note: string): Promise<{ error?: string }> {
  const officer = await requireRole("officer");
  if (!keys.length) return { error: "Select at least one line." };
  if (status !== "resolved" && status !== "credit_note") return { error: "Unknown status." };
  const admin = createAdminClient();
  const { data: lines } = await admin
    .from("self_audit_invoicing_detail")
    .select("line_key, invoice_date, source, branch, wip, invoice_no, item, description, amount")
    .eq("month", month)
    .in("line_key", keys.slice(0, 500));
  if (!lines?.length) return { error: "Those lines are no longer in the report - refresh the page." };
  const { error } = await admin.from("self_audit_invoicing_unclaimed_marks").upsert(
    lines.map((l) => ({
      line_key: l.line_key,
      status,
      note: note.trim().slice(0, 500) || null,
      month,
      invoice_date: l.invoice_date,
      source: l.source,
      branch: l.branch,
      wip: l.wip,
      invoice_no: l.invoice_no,
      item: l.item,
      description: l.description,
      amount: l.amount,
      marked_by: officer.id,
      marked_by_name: officer.full_name ?? officer.email,
      marked_at: new Date().toISOString(),
    }))
  );
  return error ? { error: error.message } : {};
}

/** Takes the mark off (the line shows as open again). */
export async function clearUnclaimedMark(keys: string[]): Promise<{ error?: string }> {
  await requireRole("officer");
  const { error } = await createAdminClient().from("self_audit_invoicing_unclaimed_marks").delete().in("line_key", keys.slice(0, 500));
  return error ? { error: error.message } : {};
}
