"use server";

import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
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
        .select("invoice_date, source, branch, branch_name, account_code, account_name, owing_operator, sales_type, amount, lines")
        .eq("month", chosen)
        .order("id")
        .range(from, from + 999);
      if (error || !data?.length) break;
      for (const r of data)
        lines.push({ d: r.invoice_date, s: r.source, b: r.branch, bn: r.branch_name, ac: r.account_code, an: r.account_name, op: r.owing_operator, t: r.sales_type, a: Number(r.amount), n: r.lines });
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
