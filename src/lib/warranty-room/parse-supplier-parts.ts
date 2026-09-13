import { extractBranchCodeFromDealerField, extractBranchCodeFromWorkOrder } from "@/lib/parse-claims";

export interface ParsedSupplierPartRow {
  branch_id: string;
  claim_number: string;
  work_order_no: string | null;
  vin: string | null;
  main_labor_name: string | null;
  part_no: string | null;
  part_name: string | null;
  planned_pickup_date: string | null;
}

export interface SkippedSupplierPartRow {
  row: number;
  reason: string;
}

const HEADER_ALIASES = {
  dealer: ["dealer", "dealer name"],
  claim_number: ["warranty claim", "claim number", "claim no"],
  work_order_no: ["work order no", "work order"],
  vin: ["vin"],
  // The source export's own column for this is a two-line Chinese header
  // ("SAGW计划" / "安排取件日期" - "SAGW plan" / "scheduled pickup date"),
  // which normalizeHeader's whitespace collapsing turns into one string.
  planned_pickup_date: ["sagw计划 安排取件日期", "安排取件日期", "pickup date", "planned pickup date"],
  main_labor_name: ["main labor name"],
  part_no: ["main part"],
  part_name: ["main part name"],
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

function parseDateValue(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const str = String(value).trim();
  if (!str) return null;
  const m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/**
 * Parses the Supplier Parts sheet - unlike "Parts should be scraped" this
 * one has a real Dealer column (dealer codes like "220309A7"), so branch is
 * resolved the primary way src/lib/parse-claims.ts does, falling back to
 * the Work Order No prefix only if that fails.
 */
export function parseSupplierParts(
  headers: string[],
  rows: unknown[][],
  branchLookup: Map<string, string>
): { parts: ParsedSupplierPartRow[]; skipped: SkippedSupplierPartRow[] } {
  const cols = matchColumns(headers);
  const parts: ParsedSupplierPartRow[] = [];
  const skipped: SkippedSupplierPartRow[] = [];

  const claimNumberCol = cols.claim_number;
  if (claimNumberCol == null) {
    throw new Error(`Supplier Parts sheet is missing a "Warranty Claim" column. Found headers: ${headers.join(", ") || "(none)"}`);
  }

  const str = (idx: number | undefined, row: unknown[]) => {
    if (idx == null) return null;
    const s = String(row[idx] ?? "").trim();
    return s || null;
  };

  rows.forEach((row, i) => {
    const rowNum = i + 2;
    const claimNumber = String(row[claimNumberCol] ?? "").trim();
    if (!claimNumber) {
      skipped.push({ row: rowNum, reason: "Missing claim number" });
      return;
    }

    const dealerRaw = str(cols.dealer, row) ?? "";
    const workOrderNo = str(cols.work_order_no, row);
    const branchRaw = extractBranchCodeFromDealerField(dealerRaw) || dealerRaw || extractBranchCodeFromWorkOrder(workOrderNo) || "";
    const branchId = branchRaw ? branchLookup.get(branchRaw.toLowerCase()) : undefined;
    if (!branchRaw || !branchId) {
      skipped.push({ row: rowNum, reason: `Unrecognized branch "${branchRaw}"` });
      return;
    }

    parts.push({
      branch_id: branchId,
      claim_number: claimNumber,
      work_order_no: workOrderNo,
      vin: str(cols.vin, row),
      main_labor_name: str(cols.main_labor_name, row),
      part_no: str(cols.part_no, row),
      part_name: str(cols.part_name, row),
      planned_pickup_date: parseDateValue(cols.planned_pickup_date != null ? row[cols.planned_pickup_date] : null),
    });
  });

  return { parts, skipped };
}
