import "server-only";
import ExcelJS from "exceljs";
import { dealerCodeOf } from "./codes";

export type ParsedComplaint = {
  key: string;
  source: string;
  complaint_no: string | null;
  created_on: string | null;
  status: string | null;
  resolved_on: string | null;
  category: string | null;
  subcategory: string | null;
  vin: string | null;
  validity: string | null;
  region: string | null;
  branch_label: string | null;
  dealer_code: string | null;
  service_advisor: string | null;
  representative: string | null;
};

/** Header names in the "Complaint Case Analysis" sheet (matched case-insensitively, extra spaces ignored). */
const COLS = {
  source: ["name", "source", "type"],
  created: ["created time", "created date", "date"],
  no: ["complaint", "complaint no", "complaint number", "case no"],
  status: ["request status", "status"],
  resolved: ["resolved time", "resolved date"],
  category: ["complaint category", "category"],
  subcategory: ["complaint subcategory", "subcategory"],
  vin: ["chassis #", "chassis", "vin"],
  validity: ["complaint validity", "validity"],
  region: ["region"],
  branch: ["branches", "branch", "city"],
  advisor: ["service advisor"],
  representative: ["complaint representative", "representative"],
} as const;

const norm = (v: string) => v.toLowerCase().replace(/\s+/g, " ").trim();

function text(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v && v.result != null) return text(v.result as ExcelJS.CellValue);
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    return "";
  }
  return String(v).trim();
}

function day(v: ExcelJS.CellValue): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000).toISOString().slice(0, 10);
  const s = text(v);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return null;
}

/** Every complaint row of the report's first sheet that has a header row with "Complaint Category". */
export async function parseComplaintsReport(bytes: Buffer | ArrayBuffer): Promise<ParsedComplaint[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as ArrayBuffer);
  for (const ws of wb.worksheets) {
    let headerRow = 0;
    const col: Partial<Record<keyof typeof COLS, number>> = {};
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (headerRow) return;
      const cells = (row.values as ExcelJS.CellValue[]).map((v) => norm(text(v)));
      if (!cells.includes("complaint category")) return;
      headerRow = n;
      for (const [k, names] of Object.entries(COLS) as [keyof typeof COLS, readonly string[]][]) {
        for (const name of names) {
          const i = cells.indexOf(name);
          if (i > 0 && !Object.values(col).includes(i)) {
            col[k] = i;
            break;
          }
        }
      }
    });
    if (!headerRow || col.category == null) continue;

    const out = new Map<string, ParsedComplaint>();
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (n <= headerRow) return;
      const v = row.values as ExcelJS.CellValue[];
      const get = (k: keyof typeof COLS) => (col[k] == null ? "" : text(v[col[k]!]));
      const source = get("source").toUpperCase();
      const created = col.created == null ? null : day(v[col.created]);
      if (!source || (!created && !get("no"))) return;
      const branch = get("branch");
      const vin = get("vin").toUpperCase() || null;
      const no = get("no") || null;
      const key = `${source}|${no ?? `${created}|${vin ?? n}`}`;
      out.set(key, {
        key,
        source,
        complaint_no: no,
        created_on: created,
        status: get("status") || null,
        resolved_on: col.resolved == null ? null : day(v[col.resolved]),
        category: get("category") || null,
        subcategory: get("subcategory") || null,
        vin,
        validity: get("validity") || null,
        region: get("region") || null,
        branch_label: branch || null,
        dealer_code: dealerCodeOf(branch),
        service_advisor: get("advisor") || null,
        representative: get("representative") || null,
      });
    });
    return [...out.values()];
  }
  return [];
}
