import "server-only";
import { unstable_cache } from "next/cache";
import { readSheetTab } from "@/lib/google-sheets";
import { dealerCodeOf } from "./codes";

/** The internal complaints log (Google Sheet, first tab). Read with the portal's Google Sheets connection. */
export const INTERNAL_SHEET_ID = "1g1a3yUrKF9bm_i80HFxXOIDj2YZ9yp5CFfjcqUW8vrs";
const GID = "0";

export type InternalRow = { date: string | null; code: string | null; category: string | null; status: string | null };
export type InternalSheet = { rows: InternalRow[]; columns: { date: string | null; branch: string | null; category: string | null; status: string | null }; totalRows: number };

const norm = (v: unknown) => String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();

function toDay(v: unknown): string | null {
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000).toISOString().slice(0, 10);
  const s = String(v ?? "").trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return null;
}

/**
 * The header row is the first row with at least three labels. Columns are found by their header (branch / date /
 * category / status words); when no header names the branch or the date, the column whose values look like a branch
 * code (A7, B7, ...) or a date is used.
 */
export function readInternal(values: unknown[][]): InternalSheet {
  const h = values.findIndex((r) => r.filter((c) => typeof c === "string" && c.trim()).length >= 3);
  if (h < 0) return { rows: [], columns: { date: null, branch: null, category: null, status: null }, totalRows: 0 };
  const header = values[h].map(norm);
  const body = values.slice(h + 1).filter((r) => r.some((c) => String(c ?? "").trim()));
  const byHeader = (test: (name: string) => boolean) => header.findIndex((n) => n && test(n));
  const share = (i: number, test: (v: unknown) => boolean) => body.slice(0, 300).filter((r) => test(r[i])).length / Math.max(1, Math.min(body.length, 300));
  const width = Math.max(...values.map((r) => r.length), 0);
  const best = (test: (v: unknown) => boolean) => {
    let pick = -1;
    let top = 0.5;
    for (let i = 0; i < width; i++) {
      const s = share(i, test);
      if (s > top) [pick, top] = [i, s];
    }
    return pick;
  };

  let branch = byHeader((n) => /\bbranch|\bco\b|company|dealer|showroom|location/.test(n));
  if (branch < 0 || share(branch, (v) => !!dealerCodeOf(String(v ?? ""))) < 0.3) branch = best((v) => !!dealerCodeOf(String(v ?? "")));
  let date = byHeader((n) => /date|created|day|received|time/.test(n) && !/resol|close|due/.test(n));
  if (date < 0 || share(date, (v) => !!toDay(v)) < 0.3) date = best((v) => !!toDay(v));
  const category = byHeader((n) => /categor|type|nature|reason|subject/.test(n) && !/sub/.test(n));
  const status = byHeader((n) => /status|state|valid/.test(n));

  const rows = body.map((r) => ({
    date: date >= 0 ? toDay(r[date]) : null,
    code: branch >= 0 ? dealerCodeOf(String(r[branch] ?? "")) : null,
    category: category >= 0 ? String(r[category] ?? "").trim() || null : null,
    status: status >= 0 ? String(r[status] ?? "").trim() || null : null,
  }));
  const name = (i: number) => (i >= 0 ? String(values[h][i] ?? "").trim() || `Column ${i + 1}` : null);
  return { rows, columns: { date: name(date), branch: name(branch), category: name(category), status: name(status) }, totalRows: body.length };
}

/** Read at most every 10 minutes; a failed read is never cached. */
export const loadInternalComplaints = unstable_cache(async () => readInternal(await readSheetTab(INTERNAL_SHEET_ID, GID)), ["internal-complaints-v1"], { revalidate: 600 });
