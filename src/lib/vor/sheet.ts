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
