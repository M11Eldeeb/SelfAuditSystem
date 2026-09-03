export interface ParsedClaimRow {
  branch_id: string;
  claim_number: string;
  work_order_no: string | null;
  has_parts: boolean;
  vin: string | null;
  vehicle_model: string | null;
  mileage: number | null;
  part_serial_number: string | null;
  part_production_date: string | null;
  repair_end_date: string | null;
  dealer_submit_date: string | null;
  creation_date: string;
  claim_amount: number | null;
  prior_approval: string | null;
  return_times: number | null;
  return_times_dealer: number | null;
  labor_code: string | null;
  main_part_name: string | null;
  raw_row: Record<string, unknown>;
}

export interface SkippedRow {
  row: number;
  reason: string;
}

/**
 * JIAD's MG/SAIC GWS export identifies the branch two different ways
 * depending on the row: either a "Dealer" code like "220309A7" (the last
 * letter+digit pair is the actual per-branch code, see
 * JIAD_DEALER_CODE_SUFFIX_MAP below) or, when Dealer/Dealer Name are blank,
 * a prefix on the work order number like "HER-11838-1". Both map to the
 * same 11 branches - confirmed against the real export on 2026-08-18.
 */
const JIAD_DEALER_CODE_SUFFIX_MAP: Record<string, string> = {
  A7: "HER", // Jeddah Heraa
  B7: "MRB", // Jeddah Madina Rd
  C7: "RSS", // Riyadh Al Saleh
  E7: "RNQ", // Riyadh North
  F7: "QSM", // Qassim
  G7: "DMM", // Dammam
  I7: "NKH", // Jeddah Nakheel
  J7: "MAD", // Madinah
  K7: "JZN", // Jizan
  L7: "ABH", // Abha
  P7: "RKR", // Riyadh Khurais
};

const FIELD_ALIASES = {
  branch: ["branch", "branch code", "branch name", "dealer", "dealer code", "outlet", "dealer name"],
  work_order_no: ["work order no", "work order number", "job card no", "job card number", "repair order no"],
  // Presence of a part here (vs. blank, meaning a labor-only claim) is used
  // to derive has_parts - cycle generation only samples claims with parts.
  main_part: ["main part", "part number", "part no", "part code"],
  claim_number: ["claim number", "claim no", "claim #", "claim id", "warranty claim"],
  vin: ["vin", "chassis number", "chassis no"],
  vehicle_model: ["model", "vehicle model", "model version"],
  mileage: ["mileage", "odometer", "km", "kilometers", "kilometres"],
  part_serial_number: ["part serial", "part serial number", "serial number"],
  part_production_date: ["part production date", "production date"],
  repair_end_date: [
    "repair end date",
    "repair end dat", // matches a known truncated header in some OEM exports
    "end of repair date",
    "repair completion date",
  ],
  dealer_submit_date: [
    "dealer submit date",
    "submission date",
    "submit date",
    "claim submission date",
    "dealer submission date",
    "last submit date(dealer)",
    "last submit date (dealer)",
  ],
  // "Reception Date" is the confirmed real column name in JIAD's export.
  creation_date: [
    "reception date",
    "creation date",
    "claim creation date",
    "job card open date",
    "created date",
  ],
  // Fields below feed internal-audit's risk-based ("flagged") sampling mode.
  // "Claim TOL." and "Main Labor" are the confirmed real column names in
  // JIAD's export - the rest were already matching correctly and are kept as
  // fallback guesses for other possible export variants.
  claim_amount: ["claim tol.", "settle tol.(vat)", "adjusted claim tol.", "claim amount", "amount", "total amount", "claim value", "warranty amount", "approved amount"],
  prior_approval: ["prior approval", "special approval", "approval required", "advance approval"],
  return_times: ["return times", "return times saic", "returns"],
  return_times_dealer: ["return times dealer", "return times (dealer)", "return times(dealer)"],
  labor_code: ["main labor", "main labor code", "labor code", "labour code", "primary labor code", "labor op code"],
} as const;

type Field = keyof typeof FIELD_ALIASES;

// "branch" is handled separately below since it can come from either a
// dedicated branch column or a Work Order No prefix.
const REQUIRED_FIELDS: Field[] = ["claim_number", "creation_date"];

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Maps each field to every column that matches one of its aliases (not just
 * the first), since some exports have multiple candidate columns for the
 * same field where only one is actually populated per row (e.g. a "Dealer"
 * code column left blank alongside a populated "Dealer Name" column).
 */
export function matchColumns(headers: string[]): Partial<Record<Field, number[]>> {
  const normalized = headers.map(normalizeHeader);
  const result: Partial<Record<Field, number[]>> = {};
  (Object.keys(FIELD_ALIASES) as Field[]).forEach((field) => {
    const indices = normalized
      .map((h, idx) => ((FIELD_ALIASES[field] as readonly string[]).includes(h) ? idx : -1))
      .filter((idx) => idx !== -1);
    if (indices.length > 0) result[field] = indices;
  });
  return result;
}

export function parseDateValue(value: unknown): string | null {
  if (value == null || value === "") return null;

  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number") {
    // Excel serial date (days since 1899-12-30, with the well-known 1900 leap-year bug)
    const epoch = Date.UTC(1899, 11, 30);
    const d = new Date(epoch + value * 86400000);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }

  const str = String(value).trim();
  if (!str) return null;

  let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;

  // Assume day/month/year for slash or dash separated dates (matches regional convention)
  m = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;

  const parsed = new Date(str);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/** Pulls a leading letters-only branch code off a work order number, e.g. "HER-11838-1" -> "HER". */
export function extractBranchCodeFromWorkOrder(value: unknown): string | null {
  if (value == null) return null;
  const match = String(value).trim().match(/^([A-Za-z]+)\s*-/);
  return match ? match[1].toUpperCase() : null;
}

/** Maps a JIAD dealer code like "220309A7" -> "HER" via the trailing letter+digit suffix. */
export function extractBranchCodeFromDealerField(value: unknown): string | null {
  if (value == null) return null;
  const match = String(value).trim().match(/([A-Za-z]\d)$/);
  if (!match) return null;
  return JIAD_DEALER_CODE_SUFFIX_MAP[match[1].toUpperCase()] ?? null;
}

export function parseClaimRows(
  headers: string[],
  rows: unknown[][],
  branchLookup: Map<string, string>
): { claims: ParsedClaimRow[]; skipped: SkippedRow[] } {
  const cols = matchColumns(headers);

  const missing = REQUIRED_FIELDS.filter((f) => !cols[f]?.length);
  if (!cols.branch?.length && !cols.work_order_no?.length) {
    missing.push("branch" as Field);
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required column(s): ${missing.join(", ")}. Found headers: ${headers.join(", ") || "(none)"}`
    );
  }

  // Tries each candidate column for this field, in header order, and returns
  // the first one that actually has a value for this row.
  const get = (row: unknown[], field: Field) => {
    const indices = cols[field];
    if (!indices) return undefined;
    for (const idx of indices) {
      const value = row[idx];
      if (value != null && String(value).trim() !== "") return value;
    }
    return undefined;
  };
  const str = (v: unknown) => {
    const s = v == null ? "" : String(v).trim();
    return s || null;
  };

  const claims: ParsedClaimRow[] = [];
  const skipped: SkippedRow[] = [];

  rows.forEach((row, i) => {
    const rowNum = i + 2; // header is row 1

    const branchFieldRaw = String(get(row, "branch") ?? "").trim();
    const branchRaw =
      extractBranchCodeFromDealerField(branchFieldRaw) ||
      branchFieldRaw ||
      extractBranchCodeFromWorkOrder(get(row, "work_order_no")) ||
      "";
    const branchId = branchRaw ? branchLookup.get(branchRaw.toLowerCase()) : undefined;
    const claimNumber = str(get(row, "claim_number"));
    const creationDate = parseDateValue(get(row, "creation_date"));

    if (!branchRaw || !branchId) {
      skipped.push({ row: rowNum, reason: `Unrecognized branch "${branchRaw}"` });
      return;
    }
    if (!claimNumber) {
      skipped.push({ row: rowNum, reason: "Missing claim number" });
      return;
    }
    if (!creationDate) {
      skipped.push({ row: rowNum, reason: "Missing or invalid creation date" });
      return;
    }

    const mileageRaw = get(row, "mileage");
    const mileageNum = mileageRaw != null && mileageRaw !== "" ? Number(mileageRaw) : NaN;

    const mainPartRaw = get(row, "main_part");

    const numOrNull = (v: unknown) => {
      if (v == null || v === "") return null;
      const n = Number(v);
      return isNaN(n) ? null : n;
    };

    // Keeps every original column (keyed by its own header text) so fields with
    // no dedicated claims column - like the free-text customer concern shown as
    // a reference next to the relevant audit question - can still be looked up.
    const rawRow: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      const v = row[idx];
      if (v != null && String(v).trim() !== "") rawRow[h] = v;
    });

    claims.push({
      branch_id: branchId,
      claim_number: claimNumber,
      work_order_no: str(get(row, "work_order_no")),
      has_parts: mainPartRaw != null && String(mainPartRaw).trim() !== "",
      vin: str(get(row, "vin")),
      vehicle_model: str(get(row, "vehicle_model")),
      mileage: isNaN(mileageNum) ? null : mileageNum,
      part_serial_number: str(get(row, "part_serial_number")),
      part_production_date: parseDateValue(get(row, "part_production_date")),
      repair_end_date: parseDateValue(get(row, "repair_end_date")),
      dealer_submit_date: parseDateValue(get(row, "dealer_submit_date")),
      creation_date: creationDate,
      claim_amount: numOrNull(get(row, "claim_amount")),
      prior_approval: str(get(row, "prior_approval")),
      return_times: numOrNull(get(row, "return_times")),
      return_times_dealer: numOrNull(get(row, "return_times_dealer")),
      labor_code: str(get(row, "labor_code")),
      main_part_name: str(mainPartRaw),
      raw_row: rawRow,
    });
  });

  return { claims, skipped };
}
