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
  amount: number;
  lines: number;
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
    if (hit == null && key !== "salesType" && key !== "branch2" && key !== "accountName") throw new Error(`Column "${names[0]}" not found.`);
    out[key] = hit ?? -1;
  }
  return out;
}

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
};

/**
 * Reads the KH9-Labor and MG5-Parts sheets of the daily report (streamed: the file is ~11 MB with a dozen other sheets)
 * and sums Sales Value per day / branch / account / owing operator / sales type.
 */
export async function parseInvoicingReport(bytes: Buffer): Promise<{ rows: InvoicingRow[]; laborLines: number; partLines: number; months: string[] }> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(bytes), {
    sharedStrings: "cache",
    hyperlinks: "ignore",
    styles: "ignore",
    worksheets: "emit",
    entries: "emit",
  });
  const groups = new Map<string, InvoicingRow>();
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
        amount: num(get("amount")),
        lines: 1,
      };
      if (!r.month) continue;
      counts[source]++;
      const key = [r.source, r.invoice_date, r.branch, r.branch_name, r.account_code, r.account_name, r.owing_operator, r.sales_type].join("|");
      const g = groups.get(key);
      if (g) {
        g.amount += r.amount;
        g.lines += 1;
      } else groups.set(key, r);
    }
  }
  if (!seen.labor || !seen.parts) throw new Error(`The report has no ${!seen.labor ? "KH9-Labor" : "MG5-Parts"} sheet.`);
  const rows = [...groups.values()].map((r) => ({ ...r, amount: Math.round(r.amount * 100) / 100 }));
  return { rows, laborLines: counts.labor, partLines: counts.parts, months: [...new Set(rows.map((r) => r.month))].sort() };
}
