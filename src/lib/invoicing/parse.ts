import "server-only";
import { Readable } from "node:stream";
import ExcelJS from "exceljs";

export type InvoicingRow = {
  month: string; // "2026-10-01"
  invoice_date: string | null;
  source: "labor" | "parts";
  branch: string;
  branch_name: string;
  account_code: string;
  account_name: string;
  owing_operator: string;
  sales_type: string;
  department: string;
  amount: number;
  lines: number;
};

/** One report line as it is (for "show me the lines behind this visual"). */
export type InvoicingDetail = {
  month: string;
  invoice_date: string | null;
  source: "labor" | "parts";
  branch: string;
  account_code: string;
  account_name: string;
  owing_operator: string;
  sales_type: string;
  department: string;
  wip: string;
  invoice_no: string;
  vin: string;
  item: string;
  description: string;
  customer: string;
  qty: number | null;
  amount: number;
};

type Cell = ExcelJS.CellValue;
const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** A cell's plain value: a formula's cached result, rich text joined, dates kept. */
function plain(c: Cell): string | number | Date | null {
  if (c == null) return null;
  if (c instanceof Date || typeof c === "string" || typeof c === "number") return c;
  if (typeof c === "boolean") return String(c);
  if (typeof c === "object") {
    if ("result" in c) return plain(c.result as Cell);
    if ("richText" in c) return c.richText.map((r) => r.text).join("");
    if ("text" in c) return String(c.text);
  }
  return null;
}
const text = (c: Cell) => {
  const v = plain(c);
  return v == null ? "" : v instanceof Date ? v.toISOString() : String(v).trim();
};
const num = (c: Cell) => {
  const v = plain(c);
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const day = (c: Cell): string | null => {
  const v = plain(c);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 30000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10); // Excel serial
  const m = String(v ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

const SALES_TYPE_BY_LETTER: Record<string, string> = { R: "Retail", I: "Internal", W: "Warranty" };

/** Column positions by header name (case and spacing ignored); the first name found wins. */
function columns(header: Cell[], wanted: Record<string, string[]>): Record<string, number> {
  const idx = new Map<string, number>();
  header.forEach((h, i) => {
    const k = norm(plain(h));
    if (k && !idx.has(k)) idx.set(k, i);
  });
  const out: Record<string, number> = {};
  for (const [key, names] of Object.entries(wanted)) {
    const hit = names.map((n) => idx.get(norm(n))).find((i) => i != null);
    if (hit == null && !OPTIONAL.has(key)) throw new Error(`Column "${names[0]}" not found.`);
    out[key] = hit ?? -1;
  }
  return out;
}

const OPTIONAL = new Set(["salesType", "branch2", "accountName", "department", "wip", "invoice", "vin", "item", "description", "customer", "qty"]);

const LABOR_COLS = {
  branch2: ["Branch Code2"],
  branch: ["Branch Code"],
  company: ["COMPANY Name"],
  account: ["Account Code"],
  accountName: ["Customer S Name"],
  owing: ["Owing Operator"],
  salesType: ["Sales Type"],
  st: ["ST"],
  date: ["Invoiced Date"],
  amount: ["Sales Value"],
  department: ["Department"],
  wip: ["WIP Number"],
  invoice: ["Invoice Number"],
  vin: ["VIN"],
  item: ["RTS Code"],
  description: ["Description"],
  customer: ["Customer S Name"],
  qty: ["Hours Sold", "Allowed Time"],
};
const PARTS_COLS = {
  branch2: ["Branch"],
  branch: ["COMPANY Name"],
  company: ["COMPANY Name"],
  account: ["Account Code"],
  accountName: ["Account Name"],
  owing: ["Owing operator"],
  salesType: ["Sales Type"],
  st: ["Sale Type"],
  date: ["Invoice Date"],
  amount: ["Sales Value"],
  department: ["Department8", "Department"],
  wip: ["WIP Number"],
  invoice: ["Invoice Number"],
  vin: ["VIN"],
  item: ["Part Number"],
  description: ["Description"],
  customer: ["Customer Contact", "Account Name"],
  qty: ["Order QTY"],
};

/**
 * Reads the KH9-Labor and MG5-Parts sheets of the daily report (streamed: the file is ~11 MB with a dozen other sheets)
 * and sums Sales Value per day / branch / account / owing operator / sales type.
 */
export async function parseInvoicingReport(bytes: Buffer): Promise<{ rows: InvoicingRow[]; details: InvoicingDetail[]; laborLines: number; partLines: number; months: string[] }> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(bytes), {
    sharedStrings: "cache",
    hyperlinks: "ignore",
    styles: "ignore",
    worksheets: "emit",
    entries: "emit",
  });
  const groups = new Map<string, InvoicingRow>();
  const details: InvoicingDetail[] = [];
  const counts = { labor: 0, parts: 0 };
  const seen = { labor: false, parts: false };

  for await (const ws of reader) {
    const name = norm((ws as unknown as { name: string }).name);
    const source = name.startsWith("kh9") ? "labor" : name.startsWith("mg5") ? "parts" : null;
    let col: Record<string, number> | null = null;
    for await (const row of ws) {
      if (!source) continue; // drain other sheets
      const values = (row as ExcelJS.Row).values as Cell[];
      if (!col) {
        col = columns(values, source === "labor" ? LABOR_COLS : PARTS_COLS);
        seen[source] = true;
        continue;
      }
      const get = (k: string) => (col![k] >= 0 ? values[col![k]] : null);
      const invoice = day(get("date"));
      if (!invoice && !text(get("account"))) continue; // blank line
      const branch = (text(get("branch2")) || text(get("branch"))).slice(0, 2).toUpperCase();
      // "A7 MG Jeddah Heraa" -> "Jeddah Heraa"
      const company = text(get("company"));
      const branchName = company.toUpperCase().startsWith(branch) ? company.slice(branch.length).replace(/^\s*MG\s+/i, "").trim() : "";
      const salesType = text(get("salesType")) || SALES_TYPE_BY_LETTER[text(get("st")).toUpperCase()] || text(get("st"));
      const r: InvoicingRow = {
        month: invoice ? `${invoice.slice(0, 7)}-01` : "",
        invoice_date: invoice,
        source,
        branch,
        branch_name: branchName.slice(0, 80),
        account_code: text(get("account")),
        account_name: text(get("accountName")).slice(0, 200),
        owing_operator: text(get("owing")),
        sales_type: salesType,
        department: text(get("department")).slice(0, 60),
        amount: num(get("amount")),
        lines: 1,
      };
      if (!r.month) continue;
      counts[source]++;
      const qty = get("qty");
      details.push({
        month: r.month,
        invoice_date: r.invoice_date,
        source,
        branch,
        account_code: r.account_code,
        account_name: r.account_name,
        owing_operator: r.owing_operator,
        sales_type: salesType,
        department: r.department,
        wip: text(get("wip")).slice(0, 30),
        invoice_no: text(get("invoice")).slice(0, 30),
        vin: text(get("vin")).slice(0, 30),
        item: text(get("item")).slice(0, 60),
        description: text(get("description")).slice(0, 200),
        customer: text(get("customer")).slice(0, 120),
        qty: qty == null || qty === "" ? null : Math.round(num(qty) * 100) / 100,
        amount: Math.round(r.amount * 100) / 100,
      });
      const key = [r.source, r.invoice_date, r.branch, r.branch_name, r.account_code, r.account_name, r.owing_operator, r.sales_type, r.department].join("|");
      const g = groups.get(key);
      if (g) {
        g.amount += r.amount;
        g.lines += 1;
      } else groups.set(key, r);
    }
  }
  if (!seen.labor || !seen.parts) throw new Error(`The report has no ${!seen.labor ? "KH9-Labor" : "MG5-Parts"} sheet.`);
  const rows = [...groups.values()].map((r) => ({ ...r, amount: Math.round(r.amount * 100) / 100 }));
  return { rows, details, laborLines: counts.labor, partLines: counts.parts, months: [...new Set(rows.map((r) => r.month))].sort() };
}
