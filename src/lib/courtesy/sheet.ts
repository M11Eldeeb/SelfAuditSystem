import "server-only";
import { unstable_cache } from "next/cache";
import { readSheetMatching } from "@/lib/google-sheets";
import { dealerCodeOf } from "@/lib/complaints/codes";

/** The courtesy (replacement) cars sheet: tab "Replacement Vehicles" (every car and its status) and "Replacement Agreements". */
export const COURTESY_SHEET_ID = "1Yby-Ckb307l-QtdtAjPsNGzo3dzTBVdDOFczHrmUO9c";

export type SheetTable = { title: string; headers: string[]; rows: string[][] };
export type CourtesyCols = {
  vehicles: Record<"plate" | "status" | "branch" | "model" | "vin", number>;
  agreements: Record<"wip" | "plate" | "status" | "branch" | "out" | "back" | "customer" | "agreement", number>;
};
export type CourtesySheet = { vehicles: SheetTable | null; agreements: SheetTable | null; cols: CourtesyCols };

const norm = (v: unknown) => String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** A cell as text; a date-looking number in a date column becomes YYYY-MM-DD. */
function cellText(v: unknown, dateCol: boolean): string {
  if (v == null) return "";
  if (typeof v === "number") {
    if (dateCol && v > 30000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86_400_000)).toISOString().slice(0, 10);
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  }
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v).trim();
}

/** The header row: the first row (of the first 15) with at least three labels. */
function readTable(title: string, values: unknown[][]): SheetTable {
  const h = values.slice(0, 15).findIndex((r) => r.filter((c) => typeof c === "string" && c.trim()).length >= 3);
  if (h < 0) return { title, headers: [], rows: [] };
  const width = Math.max(...values.slice(h).map((r) => r.length), 0);
  const headers = Array.from({ length: width }, (_, i) => String(values[h][i] ?? "").trim() || `Column ${i + 1}`);
  const isDate = headers.map((x) => /date|time|out|return|start|end|from|until|issued|back|in$/i.test(x));
  const rows = values
    .slice(h + 1)
    .map((r) => Array.from({ length: width }, (_, i) => cellText(r[i], isDate[i])))
    .filter((r) => r.some(Boolean));
  return { title, headers, rows };
}

function find(headers: string[], tests: RegExp[], taken: Set<number>): number {
  for (const re of tests) {
    const i = headers.findIndex((x, j) => !taken.has(j) && re.test(norm(x)));
    if (i >= 0) {
      taken.add(i);
      return i;
    }
  }
  return -1;
}

const STAGE_WORDS = /^(open|opened|closed|close|returned|return|completed|complete|active|cancel+ed|in progress|with customer|out|available|in use|maintenance|reserved)$/i;

/** The stage / status column: named "Stage" first, then a stage / status header, else the column whose values are mostly Open / Closed... */
function stageColumn(t: SheetTable | null, taken: Set<number>): number {
  if (!t) return -1;
  const h = t.headers;
  for (const re of [/^stage$/, /stage/, /^status$/, /status/, /state/]) {
    const i = h.findIndex((x, j) => !taken.has(j) && re.test(norm(x)));
    if (i >= 0) {
      taken.add(i);
      return i;
    }
  }
  const sample = t.rows.slice(0, 300);
  let best = -1;
  let top = 0.6;
  for (let j = 0; j < h.length; j++) {
    if (taken.has(j)) continue;
    const filled = sample.filter((r) => r[j]);
    const share = filled.length ? filled.filter((r) => STAGE_WORDS.test(r[j].trim())).length / filled.length : 0;
    if (share > top) [best, top] = [j, share];
  }
  if (best >= 0) taken.add(best);
  return best;
}

export function courtesyColumns(v: SheetTable | null, a: SheetTable | null): CourtesyCols {
  const vt = new Set<number>();
  const vh = v?.headers ?? [];
  const at = new Set<number>();
  const ah = a?.headers ?? [];
  // The stage (status) first, so no other field takes its column.
  const vStatus = stageColumn(v, vt);
  const aStatus = stageColumn(a, at);
  return {
    vehicles: {
      status: vStatus,
      plate: find(vh, [/plate/, /registration|\breg\b/, /vehicle no|car no/], vt),
      vin: find(vh, [/vin|chassis/], vt),
      branch: find(vh, [/branch|location|site|showroom/, /\bco\b|company/], vt),
      model: find(vh, [/model/, /make|vehicle|car/], vt),
    },
    agreements: {
      status: aStatus,
      wip: find(ah, [/wip/, /work ?order|\bwo\b|job/], at),
      agreement: find(ah, [/agreement (no|number|#|id)|^agreement$/, /agreement|contract|\bra\b no|ref/], at),
      plate: find(ah, [/plate/, /registration|\breg\b/, /vehicle no|car no/], at),
      branch: find(ah, [/branch|location|site|showroom/, /\bco\b|company/], at),
      out: find(ah, [/(out|issue|start|delivery|from|handover).*date|date.*(out|issue|start|from)|^out$|check ?out/, /^date$|created/], at),
      // An actual return date - not an expected / planned / due one.
      back: find(ah, [/^(?!.*(expect|plan|due|estimat|target)).*((return|back|close|check ?in).*date|date.*(return|back|in)|^returned( on| at)?$|^check ?in$)/], at),
      customer: find(ah, [/customer|client|name/], at),
    },
  };
}

async function read(): Promise<CourtesySheet> {
  const [vehicles, agreements] = await Promise.all([
    readSheetMatching(COURTESY_SHEET_ID, (t) => /vehicle/i.test(t) && !/agreement/i.test(t)),
    readSheetMatching(COURTESY_SHEET_ID, (t) => /agreement/i.test(t)),
  ]);
  const v = vehicles ? readTable(vehicles.title, vehicles.values) : null;
  const a = agreements ? readTable(agreements.title, agreements.values) : null;
  return { vehicles: v, agreements: a, cols: courtesyColumns(v, a) };
}

/** Read at most every 10 minutes; a failed read is not cached. */
export const loadCourtesy = unstable_cache(read, ["courtesy-cars-v3"], { revalidate: 600 });

/** "HER-123456", "123456", "0123456" -> "123456" (for matching WIP numbers). */
export const wipKey = (v: string) => v.toUpperCase().replace(/^[A-Z]{2,4}[-\s]*/, "").replace(/\D/g, "").replace(/^0+/, "");

/** A branch code in a cell (A7, A7 MG Jeddah Heraa...) or null. */
export const branchCodeIn = (v: string) => dealerCodeOf(v);

/** An agreement is still open when it has no return date and its status does not say closed / returned. */
export function agreementOpen(row: string[], cols: CourtesyCols["agreements"]): boolean {
  const back = cols.back >= 0 ? row[cols.back] : "";
  const status = cols.status >= 0 ? row[cols.status] : "";
  // The stage decides when it is filled in; the return date only when it is empty.
  if (status.trim()) return !/clos|return|complet|done|finish|cancel/i.test(status);
  return !back;
}
