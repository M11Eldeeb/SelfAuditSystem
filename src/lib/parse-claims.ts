export interface ParsedClaimRow {
  branch_id: string;
  claim_number: string;
  vin: string | null;
  vehicle_model: string | null;
  mileage: number | null;
  part_serial_number: string | null;
  part_production_date: string | null;
  repair_end_date: string | null;
  dealer_submit_date: string | null;
  creation_date: string;
  raw_row: Record<string, unknown>;
}

export interface SkippedRow {
  row: number;
  reason: string;
}

const FIELD_ALIASES = {
  branch: ["branch", "branch code", "branch name", "dealer", "dealer code", "outlet"],
  claim_number: ["claim number", "claim no", "claim #", "claim id"],
  vin: ["vin", "chassis number", "chassis no"],
  vehicle_model: ["model", "vehicle model"],
  mileage: ["mileage", "odometer", "km", "kilometers", "kilometres"],
  part_serial_number: ["part serial", "part serial number", "serial number"],
  part_production_date: ["part production date", "production date"],
  repair_end_date: ["repair end date", "end of repair date", "repair completion date"],
  dealer_submit_date: [
    "dealer submit date",
    "submission date",
    "submit date",
    "claim submission date",
    "dealer submission date",
  ],
  creation_date: ["creation date", "claim creation date", "job card open date", "created date"],
} as const;

type Field = keyof typeof FIELD_ALIASES;

const REQUIRED_FIELDS: Field[] = ["branch", "claim_number", "creation_date"];

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

export function matchColumns(headers: string[]): Partial<Record<Field, number>> {
  const normalized = headers.map(normalizeHeader);
  const result: Partial<Record<Field, number>> = {};
  (Object.keys(FIELD_ALIASES) as Field[]).forEach((field) => {
    const idx = normalized.findIndex((h) => (FIELD_ALIASES[field] as readonly string[]).includes(h));
    if (idx !== -1) result[field] = idx;
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

export function parseClaimRows(
  headers: string[],
  rows: unknown[][],
  branchLookup: Map<string, string>
): { claims: ParsedClaimRow[]; skipped: SkippedRow[] } {
  const cols = matchColumns(headers);

  const missing = REQUIRED_FIELDS.filter((f) => cols[f] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `Missing required column(s): ${missing.join(", ")}. Found headers: ${headers.join(", ") || "(none)"}`
    );
  }

  const get = (row: unknown[], field: Field) => {
    const idx = cols[field];
    return idx === undefined ? undefined : row[idx];
  };
  const str = (v: unknown) => {
    const s = v == null ? "" : String(v).trim();
    return s || null;
  };

  const claims: ParsedClaimRow[] = [];
  const skipped: SkippedRow[] = [];

  rows.forEach((row, i) => {
    const rowNum = i + 2; // header is row 1

    const branchRaw = String(get(row, "branch") ?? "").trim();
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

    const raw_row: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      raw_row[h] = row[idx] ?? null;
    });

    claims.push({
      branch_id: branchId,
      claim_number: claimNumber,
      vin: str(get(row, "vin")),
      vehicle_model: str(get(row, "vehicle_model")),
      mileage: isNaN(mileageNum) ? null : mileageNum,
      part_serial_number: str(get(row, "part_serial_number")),
      part_production_date: parseDateValue(get(row, "part_production_date")),
      repair_end_date: parseDateValue(get(row, "repair_end_date")),
      dealer_submit_date: parseDateValue(get(row, "dealer_submit_date")),
      creation_date: creationDate,
      raw_row,
    });
  });

  return { claims, skipped };
}
