import { extractBranchCodeFromWorkOrder, parseDateValue } from "@/lib/parse-claims";

export interface ParsedScrapRequestRow {
  branch_id: string;
  claim_number: string;
  work_order_no: string | null;
  main_labor_code: string | null;
  main_labor_name: string | null;
  settlement_date: string | null;
  holding_period_days: number | null;
}

export interface SkippedScrapRequestRow {
  row: number;
  reason: string;
}

const HEADER_ALIASES = {
  claim_number: ["warranty claim", "claim number", "claim no"],
  work_order_no: ["work order", "work order no"],
  main_labor_code: ["main labor"],
  main_labor_name: ["main labor des.", "main labor des", "main labor name"],
  settlement_date: ["settlement date"],
  holding_period_days: ["holding period"],
} as const;

type Field = keyof typeof HEADER_ALIASES;

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

function matchColumns(headers: string[]): Partial<Record<Field, number>> {
  const normalized = headers.map(normalizeHeader);
  const result: Partial<Record<Field, number>> = {};
  (Object.keys(HEADER_ALIASES) as Field[]).forEach((field) => {
    const idx = normalized.findIndex((h) => (HEADER_ALIASES[field] as readonly string[]).includes(h));
    if (idx !== -1) result[field] = idx;
  });
  return result;
}

/**
 * Parses "RepClaimOrderView" from the "Parts should be scraped" export - one
 * row per claim (not per part; the actual part list for each claim comes
 * from self_audit_claim_parts, looked up server-side by claim number). This
 * sheet has no Dealer column, so branch is resolved only from the Work
 * Order prefix (same fallback src/lib/parse-claims.ts uses when a Dealer
 * field is absent).
 */
export function parseScrapRequests(
  headers: string[],
  rows: unknown[][],
  branchLookup: Map<string, string>
): { requests: ParsedScrapRequestRow[]; skipped: SkippedScrapRequestRow[] } {
  const cols = matchColumns(headers);
  const requests: ParsedScrapRequestRow[] = [];
  const skipped: SkippedScrapRequestRow[] = [];

  const claimNumberCol = cols.claim_number;
  if (claimNumberCol == null) {
    throw new Error(
      `RepClaimOrderView sheet is missing a "Warranty Claim" column. Found headers: ${headers.join(", ") || "(none)"}`
    );
  }

  const str = (idx: number | undefined, row: unknown[]) => {
    if (idx == null) return null;
    const s = String(row[idx] ?? "").trim();
    return s || null;
  };
  const num = (idx: number | undefined, row: unknown[]) => {
    if (idx == null) return null;
    const raw = row[idx];
    if (raw == null || raw === "") return null;
    const n = Number(raw);
    return isNaN(n) ? null : n;
  };

  rows.forEach((row, i) => {
    const rowNum = i + 2;
    const claimNumber = String(row[claimNumberCol] ?? "").trim();
    if (!claimNumber) {
      skipped.push({ row: rowNum, reason: "Missing claim number" });
      return;
    }

    const workOrderNo = str(cols.work_order_no, row);
    const branchRaw = extractBranchCodeFromWorkOrder(workOrderNo) || "";
    const branchId = branchRaw ? branchLookup.get(branchRaw.toLowerCase()) : undefined;
    if (!branchRaw || !branchId) {
      skipped.push({ row: rowNum, reason: `Unrecognized branch "${branchRaw}"` });
      return;
    }

    requests.push({
      branch_id: branchId,
      claim_number: claimNumber,
      work_order_no: workOrderNo,
      main_labor_code: str(cols.main_labor_code, row),
      main_labor_name: str(cols.main_labor_name, row),
      settlement_date: parseDateValue(cols.settlement_date != null ? row[cols.settlement_date] : null),
      holding_period_days: num(cols.holding_period_days, row),
    });
  });

  return { requests, skipped };
}
