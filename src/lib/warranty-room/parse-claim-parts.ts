import { extractBranchCodeFromDealerField, extractBranchCodeFromWorkOrder, parseDateValue } from "@/lib/parse-claims";

export interface ParsedClaimPartRow {
  /** Best-effort guess from this row's own Dealer field - null when that field is blank/unrecognized. Not fatal: upsertClaimPartsChunk resolves the real branch_id from the matched claim instead of relying on this. */
  branch_id: string | null;
  claim_number: string;
  part_no: string;
  part_name: string | null;
  quantity: number | null;
}

export interface SkippedPartRow {
  row: number;
  reason: string;
}

const HEADER_ALIASES = {
  dealer: ["dealer", "dealer name"],
  claim_number: ["warranty claim", "claim number", "claim no"],
  part_no: ["part no", "part number"],
  part_name: ["part name"],
  quantity: ["quantity", "qty"],
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
 * Parses the "Part Details" sheet from the claims data export into one row
 * per part per claim - self_audit_claims only ever stores one ("main") part
 * per claim, so this is the only place every part on a claim is available.
 *
 * This sheet has no Work Order column at all, and in real exports a large
 * share of rows (confirmed ~39% in one real 78k-row export) have a blank
 * Dealer field with no other row for that same claim carrying one either -
 * not sparse/inconsistent, entire claims just have no Dealer on this sheet.
 * A row is no longer dropped for that - branch_id here is only a best-effort
 * hint from the Dealer field when present; upsertClaimPartsChunk resolves
 * the real branch_id by matching the claim itself (already looked up by
 * claim_number), the same claim_number-only fallback insertScrappedPartsChunk
 * already uses for a sheet with the same gap.
 */
export function parseClaimParts(
  headers: string[],
  rows: unknown[][],
  branchLookup: Map<string, string>
): { parts: ParsedClaimPartRow[]; skipped: SkippedPartRow[] } {
  const cols = matchColumns(headers);
  const parts: ParsedClaimPartRow[] = [];
  const skipped: SkippedPartRow[] = [];

  const claimNumberCol = cols.claim_number;
  const partNoCol = cols.part_no;
  if (claimNumberCol == null || partNoCol == null) {
    throw new Error(
      `Part Details sheet is missing a "Warranty Claim" or "Part No" column. Found headers: ${headers.join(", ") || "(none)"}`
    );
  }

  rows.forEach((row, i) => {
    const rowNum = i + 2;
    const dealerRaw = cols.dealer != null ? String(row[cols.dealer] ?? "").trim() : "";
    const branchRaw = extractBranchCodeFromDealerField(dealerRaw) || dealerRaw || extractBranchCodeFromWorkOrder(dealerRaw) || "";
    const branchId = branchRaw ? (branchLookup.get(branchRaw.toLowerCase()) ?? null) : null;
    const claimNumber = String(row[claimNumberCol] ?? "").trim();
    const partNo = String(row[partNoCol] ?? "").trim();

    if (!claimNumber) {
      skipped.push({ row: rowNum, reason: "Missing claim number" });
      return;
    }
    if (!partNo) {
      skipped.push({ row: rowNum, reason: "Missing part number" });
      return;
    }

    const quantityRaw = cols.quantity != null ? row[cols.quantity] : null;
    const quantity = quantityRaw != null && quantityRaw !== "" ? Number(quantityRaw) : null;
    const partNameRaw = cols.part_name != null ? String(row[cols.part_name] ?? "").trim() : "";

    parts.push({
      branch_id: branchId,
      claim_number: claimNumber,
      part_no: partNo,
      part_name: partNameRaw || null,
      quantity: quantity != null && !isNaN(quantity) ? quantity : null,
    });
  });

  return { parts, skipped };
}

// Re-exported so callers parsing both sheets from one file don't need to
// import parseDateValue from two different modules.
export { parseDateValue };
