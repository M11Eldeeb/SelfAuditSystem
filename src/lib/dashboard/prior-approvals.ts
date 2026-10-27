import "server-only";
import { unstable_cache } from "next/cache";
import { getSheetsStatus, readSheetTab } from "@/lib/google-sheets";
import { JIAD_DEALER_CODE_SUFFIX_MAP } from "@/lib/parse-claims";

/**
 * The Warranty Prior Approvals sheet (the live Google Sheet behind the company's Looker Studio report): one row per
 * prior-approval case with the dealer company code ("Co", e.g. A7 = Jeddah Heraa), WIP number, submission date, main part
 * and status. The dashboard shows cases per branch, cases over time and the status split, so the rows are reduced here to
 * a small cube - (month, Co, status) -> number of cases - which the page then filters in the browser.
 */

export const PRIOR_APPROVALS_SHEET_ID = process.env.PRIOR_APPROVALS_SHEET_ID || "1FvEz0XLK5Fgb8Fn7p7ezjfcSIwtIokW_ROwtk9jJyyo";
/** The workbook has one tab per branch plus this consolidated tab ("Conolidate" - Co, WIP Number, Submission Date, Main part, Status, ...), which is what the Looker Studio report reads. */
export const PRIOR_APPROVALS_GID = process.env.PRIOR_APPROVALS_GID || "983857517";

/** m is "YYYY-MM", or "" for a case with no submission date. */
export type CubeRow = { m: string; co: string | null; s: string; n: number };

export type PriorApprovals =
  | {
      status: "ok";
      /** Every case in the sheet, and how many of them have no submission date (counted per branch and status, not per month). */
      total: number;
      undated: number;
      updatedAt: string;
      /** Every Co code in the sheet with the branch it belongs to. */
      branches: { co: string | null; label: string }[];
      months: string[];
      cube: CubeRow[];
    }
  | { status: "not_connected" }
  | { status: "error"; message: string };

const HEADER_ALIASES = {
  co: ["co", "company", "company code", "dealer code", "branch code", "branch"],
  date: ["submission date", "submit date", "date submitted", "date"],
  status: ["status"],
} as const;

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function findColumn(header: unknown[], aliases: readonly string[]): number {
  const h = header.map(norm);
  for (const a of aliases) {
    const i = h.indexOf(a);
    if (i !== -1) return i;
  }
  return -1;
}

/** Google Sheets serial day number -> "YYYY-MM-DD". */
function serialToIso(n: number): string {
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86_400_000).toISOString().slice(0, 10);
}

/** Decides from the whole column whether a slashed date is day-first or month-first (an unambiguous value settles it; default month-first). */
function dayFirst(values: unknown[]): boolean {
  let monthFirstSeen = false;
  let dayFirstSeen = false;
  for (const v of values) {
    const m = typeof v === "string" ? v.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/) : null;
    if (!m) continue;
    if (Number(m[1]) > 12) dayFirstSeen = true;
    if (Number(m[2]) > 12) monthFirstSeen = true;
  }
  return dayFirstSeen && !monthFirstSeen;
}

function toMonth(v: unknown, isDayFirst: boolean): string | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 20_000 && v < 80_000) return serialToIso(v).slice(0, 7);
  if (typeof v !== "string") return null;
  const t = v.trim();
  const iso = t.match(/^(\d{4})-(\d{2})-\d{2}/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const sl = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (sl) {
    const month = Number(isDayFirst ? sl[2] : sl[1]);
    const year = Number(sl[3].length === 2 ? `20${sl[3]}` : sl[3]);
    return month >= 1 && month <= 12 ? `${year}-${String(month).padStart(2, "0")}` : null;
  }
  const parsed = Date.parse(t);
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  return null;
}

/** Typos the team types into the status column - they would otherwise show as separate slices. */
const STATUS_FIXES: [RegExp, string][] = [
  [/compeleted/gi, "Completed"],
  [/returened|returend/gi, "Returned"],
  [/spesilist/gi, "Specialist"],
];

/** "\" Start repair \"Approved" and "Start repair Approved" are the same status; case, stray quotes and the usual typos do not split it. */
function cleanStatus(v: unknown): string {
  let t = String(v ?? "").replace(/["“”]/g, " ").replace(/\s+/g, " ").trim();
  for (const [re, to] of STATUS_FIXES) t = t.replace(re, to);
  return t;
}

function aggregate(rows: unknown[][]): { total: number; undated: number; cube: CubeRow[]; months: string[]; cos: (string | null)[] } {
  const header = rows[0] ?? [];
  const coCol = findColumn(header, HEADER_ALIASES.co);
  const dateCol = findColumn(header, HEADER_ALIASES.date);
  const statusCol = findColumn(header, HEADER_ALIASES.status);
  if (dateCol === -1 || statusCol === -1) {
    throw new Error(`The sheet's header row has no "Submission Date" or "Status" column (found: ${header.map((h) => String(h)).join(", ") || "nothing"}).`);
  }
  const body = rows.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  const isDayFirst = dayFirst(body.map((r) => r[dateCol]));

  const spellings = new Map<string, Map<string, number>>(); // lower-case status -> how each spelling was written
  const counts = new Map<string, { m: string; co: string | null; key: string; n: number }>();
  let undated = 0;
  for (const r of body) {
    const dated = toMonth(r[dateCol], isDayFirst);
    if (!dated) undated += 1;
    const m = dated ?? "";
    const rawCo = coCol === -1 ? "" : String(r[coCol] ?? "").trim().toUpperCase();
    const co = rawCo && rawCo !== "NULL" ? rawCo : null;
    const status = cleanStatus(r[statusCol]) || "No status";
    const key = status.toLowerCase();
    const sp = spellings.get(key) ?? new Map<string, number>();
    sp.set(status, (sp.get(status) ?? 0) + 1);
    spellings.set(key, sp);
    const id = `${m}|${co ?? ""}|${key}`;
    const cur = counts.get(id);
    if (cur) cur.n += 1;
    else counts.set(id, { m, co, key, n: 1 });
  }
  const labelOf = (key: string) => [...(spellings.get(key) ?? new Map([[key, 1]])).entries()].sort((a, b) => b[1] - a[1])[0][0];
  const cube = [...counts.values()].map((c) => ({ m: c.m, co: c.co, s: labelOf(c.key), n: c.n }));
  return {
    total: body.length,
    undated,
    cube,
    months: [...new Set(cube.map((c) => c.m).filter(Boolean))].sort(),
    cos: [...new Set(cube.map((c) => c.co))],
  };
}

/** The sheet is read at most every two minutes; a failed read is never cached. */
const readAggregated = unstable_cache(async () => aggregate(await readSheetTab(PRIOR_APPROVALS_SHEET_ID, PRIOR_APPROVALS_GID)), ["prior-approvals-sheet-v1"], { revalidate: 120 });

/** `branches` carry the portal's branch code (HER, RNQ, ...), which the sheet's Co code (A7, E7, ...) maps onto. */
export async function loadPriorApprovals(branches: { name: string; code: string | null }[]): Promise<PriorApprovals> {
  if (!(await getSheetsStatus())) return { status: "not_connected" };
  try {
    const agg = await readAggregated();
    const nameByCode = new Map(branches.filter((b) => b.code).map((b) => [b.code!.toUpperCase(), b.name]));
    const label = (co: string | null) => {
      if (!co) return "No branch code";
      const branchCode = JIAD_DEALER_CODE_SUFFIX_MAP[co];
      return (branchCode && nameByCode.get(branchCode)) || co;
    };
    return {
      status: "ok",
      total: agg.total,
      undated: agg.undated,
      updatedAt: new Date().toISOString(),
      branches: agg.cos.map((co) => ({ co, label: label(co) })).sort((a, b) => a.label.localeCompare(b.label)),
      months: agg.months,
      cube: agg.cube,
    };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "Could not read the sheet." };
  }
}
