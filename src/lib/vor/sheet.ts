import "server-only";
import ExcelJS from "exceljs";
import { docsFetch, DocsError } from "@/lib/documents/drive-docs";

/** The VOR parts tracker (an Excel file on Google Drive, read with the documents' Google connection). */
export const VOR_FILE_ID = "1GEoPyrXrVli_w5cUaHz3WIb8PY_R-oU_";
const API = "https://www.googleapis.com/drive/v3/files";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const TTL = 10 * 60_000;

export type VorSheet = { fileName: string; modifiedTime: string | null; sheetName: string; headers: string[]; rows: string[][]; loadedAt: number };

function text(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("error" in v) return "";
    if ("result" in v) return text(v.result as ExcelJS.CellValue);
    if ("richText" in v) return v.richText.map((t) => t.text).join("").trim();
    if ("text" in v) return String(v.text).trim();
    if ("hyperlink" in v) return String((v as { hyperlink: string }).hyperlink);
    return "";
  }
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
  return String(v).trim();
}

/** The header row: within the first 30 rows, the one with the most labels that mentions a part. */
function readSheet(ws: ExcelJS.Worksheet): { headers: string[]; rows: string[][] } | null {
  let best = { row: 0, score: 0 };
  for (let n = 1; n <= Math.min(30, ws.rowCount); n++) {
    const cells = (ws.getRow(n).values as ExcelJS.CellValue[]).slice(1).map(text);
    const labels = cells.filter((c) => c && !/^\d+([.,]\d+)?$/.test(c)).length;
    const score = labels + (cells.some((c) => /part/i.test(c)) ? 5 : 0);
    if (labels >= 3 && score > best.score) best = { row: n, score };
  }
  if (!best.row) return null;
  const raw = (ws.getRow(best.row).values as ExcelJS.CellValue[]).slice(1).map(text);
  const width = raw.length;
  const headers = raw.map((h, i) => h || `Column ${i + 1}`);
  const rows: string[][] = [];
  for (let n = best.row + 1; n <= ws.rowCount; n++) {
    const v = ws.getRow(n).values as ExcelJS.CellValue[];
    const r = Array.from({ length: width }, (_, i) => text(v[i + 1]));
    if (r.some(Boolean)) rows.push(r);
  }
  return { headers, rows };
}

let cache: VorSheet | null = null;
let loading: Promise<VorSheet> | null = null;

async function download(): Promise<VorSheet> {
  const metaRes = await docsFetch(`${API}/${VOR_FILE_ID}?fields=name,mimeType,modifiedTime&supportsAllDrives=true`);
  const meta = (await metaRes.json().catch(() => ({}))) as { name?: string; mimeType?: string; modifiedTime?: string; error?: { message?: string } };
  if (!metaRes.ok) throw new DocsError(metaRes.status === 404 || metaRes.status === 403 ? "The documents' Google account cannot open the VOR file - share it with that account." : `Google Drive replied ${metaRes.status}: ${meta.error?.message ?? "no details"}`);
  if (cache && cache.modifiedTime === (meta.modifiedTime ?? null)) return { ...cache, loadedAt: Date.now() };
  const url =
    meta.mimeType === "application/vnd.google-apps.spreadsheet" ? `${API}/${VOR_FILE_ID}/export?mimeType=${encodeURIComponent(XLSX)}` : `${API}/${VOR_FILE_ID}?alt=media&supportsAllDrives=true`;
  const res = await docsFetch(url);
  if (!res.ok) throw new DocsError(`Could not download the VOR file (${res.status}).`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await res.arrayBuffer());
  // The tab with the most rows that has a parts header.
  let pick: { name: string; headers: string[]; rows: string[][] } | null = null;
  for (const ws of wb.worksheets) {
    const s = readSheet(ws);
    if (s && (!pick || s.rows.length > pick.rows.length)) pick = { name: ws.name, ...s };
  }
  if (!pick) throw new DocsError("The VOR file has no sheet with a header row.");
  return { fileName: meta.name ?? "VOR file", modifiedTime: meta.modifiedTime ?? null, sheetName: pick.name, headers: pick.headers, rows: pick.rows, loadedAt: Date.now() };
}

/** The VOR rows, re-read from Drive at most every 10 minutes (and only downloaded again when the file changed). */
export async function loadVor(): Promise<VorSheet> {
  if (cache && Date.now() - cache.loadedAt < TTL) return cache;
  loading ??= download()
    .then((s) => (cache = s))
    .finally(() => (loading = null));
  return loading;
}

export type VorLine = {
  part: string | null;
  description: string | null;
  eta: string | null;
  status: string | null;
  qty: string | null;
  /** The branch as the file says it (branch / dealer column, or the prefix on the WIP, e.g. "HER-31941"). */
  branch: string | null;
  /** The order date, YYYY-MM-DD when readable. */
  orderDate: string | null;
};

/** A date cell as YYYY-MM-DD (ISO text, or day-first 28/01/2026). */
function isoDay(v: string): string | null {
  const s = v.trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (!m) return null;
  let [d, mo] = [Number(m[1]), Number(m[2])];
  if (mo > 12 && d <= 12) [d, mo] = [mo, d];
  return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * VOR lines by WIP number ("HER-123456" / "123456" -> "123456"), from every WIP / work order column of the VOR file.
 * Null when the file cannot be read (callers just show nothing).
 */
export async function vorByWip(): Promise<Map<string, VorLine[]> | null> {
  let sheet: VorSheet;
  try {
    sheet = await loadVor();
  } catch {
    return null;
  }
  const h = sheet.headers;
  const idx = (re: RegExp, not?: RegExp) => h.findIndex((x) => re.test(x) && !(not && not.test(x)));
  const wipCols = h.map((x, i) => (/wip|work\s*order|\bw\.?o\.?\b/i.test(x) ? i : -1)).filter((i) => i >= 0);
  const part = idx(/part\s*(no|number|num|#|code)|^part$/i);
  const desc = idx(/desc|part\s*name/i);
  const eta = idx(/eta.*pdc|pdc.*eta/i) >= 0 ? idx(/eta.*pdc|pdc.*eta/i) : idx(/\beta\b/i);
  const status = idx(/status|remark/i);
  const qty = idx(/order(ed)?\s*q(ty|uantity)|\bq(ty|uantity)\b/i);
  const branchCol = h.findIndex((x) => /branch|dealer|location|showroom|site|\bco\b/i.test(x) && !/wip|work\s*order|po\b|order\s*no/i.test(x));
  const orderDate = idx(/order\s*(place|placed|placing)?\s*date|date.*order|placed/i);
  const key = (v: string) => v.toUpperCase().replace(/^[A-Z]{2,4}[-\s]*/, "").replace(/\D/g, "").replace(/^0+/, "");
  const map = new Map<string, VorLine[]>();
  for (const r of sheet.rows) {
    const base = {
      part: part >= 0 ? r[part] || null : null,
      description: desc >= 0 ? r[desc] || null : null,
      eta: eta >= 0 ? r[eta] || null : null,
      status: status >= 0 ? r[status] || null : null,
      qty: qty >= 0 ? r[qty] || null : null,
      orderDate: orderDate >= 0 ? isoDay(r[orderDate] ?? "") : null,
    };
    const seen = new Set<string>();
    for (const i of wipCols) {
      const cell = (r[i] ?? "").trim();
      const k = key(cell);
      if (k.length < 3 || seen.has(k)) continue;
      seen.add(k);
      const prefix = cell.toUpperCase().match(/^([A-Z]{2,4})[-\s]*\d/)?.[1] ?? null;
      map.set(k, [...(map.get(k) ?? []), { ...base, branch: (branchCol >= 0 ? r[branchCol] : "") || prefix }]);
    }
  }
  return map;
}
