import { extractBranchCodeFromWorkOrder, parseDateValue } from "@/lib/parse-claims";

export interface ParsedScrappedPartRow {
  branch_id: string | null;
  claim_number: string;
  external_request_no: string | null;
  work_order_no: string | null;
  vin: string | null;
  part_no: string | null;
  part_name: string | null;
  quantity: number | null;
  main_labor_code: string | null;
  main_labor_name: string | null;
  settlement_date: string | null;
  holding_period_days: number | null;
}

export interface SkippedScrappedRow {
  row: number;
  reason: string;
}

const HEADER_ALIASES = {
  request: ["request"],
  claim_number: ["claim order", "warranty claim", "claim number"],
  work_order_no: ["work order", "work order no"],
  vin: ["vin"],
  part_no: ["part"],
  part_name: ["part des.", "part des", "part name"],
  quantity: ["qty", "quantity"],
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
 * Parses "RepPartToDestroyDetailsView" from the "Parts Already Scraped"
 * export - one row per already-destroyed part. This sheet has no Dealer
 * column, so branch is resolved only from the Work Order No prefix (same
 * fallback src/lib/parse-claims.ts uses when a Dealer field is absent). A
 * row that can't be matched to a branch is still kept (branch_id null) since
 * it's still valid reference data for the do-not-scrap report - it's simply
 * not filterable by branch until/unless matched to a claim later.
 */
export function parseScrappedParts(
  headers: string[],
  rows: unknown[][],
  branchLookup: Map<string, string>
): { parts: ParsedScrappedPartRow[]; skipped: SkippedScrappedRow[] } {
  const cols = matchColumns(headers);
  const parts: ParsedScrappedPartRow[] = [];
  const skipped: SkippedScrappedRow[] = [];

  if (cols.claim_number == null) {
    throw new Error(
      `RepPartToDestroyDetailsView sheet is missing a "Claim order" column. Found headers: ${headers.join(", ") || "(none)"}`
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
    const claimNumber = str(cols.claim_number, row);
    if (!claimNumber) {
      skipped.push({ row: rowNum, reason: "Missing claim number" });
      return;
    }

    const workOrderNo = str(cols.work_order_no, row);
    const branchRaw = extractBranchCodeFromWorkOrder(workOrderNo) || "";
    const branchId = branchRaw ? (branchLookup.get(branchRaw.toLowerCase()) ?? null) : null;

    parts.push({
      branch_id: branchId,
      claim_number: claimNumber,
      external_request_no: str(cols.request, row),
      work_order_no: workOrderNo,
      vin: str(cols.vin, row),
      part_no: str(cols.part_no, row),
      part_name: str(cols.part_name, row),
      quantity: num(cols.quantity, row),
      main_labor_code: str(cols.main_labor_code, row),
      main_labor_name: str(cols.main_labor_name, row),
      settlement_date: parseDateValue(cols.settlement_date != null ? row[cols.settlement_date] : null),
      holding_period_days: num(cols.holding_period_days, row),
    });
  });

  return { parts, skipped };
}
