import type { Database } from "@/lib/supabase/types";

type Claim = Database["public"]["Tables"]["self_audit_claims"]["Row"];

// Header aliases for the free-text "customer concern" column, looked up directly
// in raw_row since it isn't parsed into its own claims column. "Customer
// Complaint Des" is the confirmed real column name in JIAD's export - note
// "fault description" is a DIFFERENT, unrelated column in that export and is
// deliberately not listed here. The rest are fallback guesses for other
// possible export variants.
const CUSTOMER_CONCERN_ALIASES = [
  "customer complaint des",
  "customer concern",
  "concern",
  "complaint",
  "customer complaint",
  "customer's concern",
  "concern description",
  "reported concern",
  "reported complaint",
  "customer voice",
];

function findRawRowValue(rawRow: Record<string, unknown>, aliases: string[]): string | null {
  const entries = Object.entries(rawRow);
  for (const alias of aliases) {
    const hit = entries.find(([key]) => key.trim().toLowerCase() === alias);
    if (hit && hit[1] != null && String(hit[1]).trim() !== "") return String(hit[1]).trim();
  }
  return null;
}

/**
 * Surfaces the claims-data value a question is meant to be cross-checked against
 * (e.g. the mileage question next to the claim's actual mileage), so the person
 * answering doesn't have to look it up separately.
 */
export function getClaimReference(questionId: string, claim: Claim | null | undefined): string | null {
  if (!claim) return null;

  switch (questionId) {
    case "mileage":
      return claim.mileage != null ? `${claim.mileage.toLocaleString()} km` : "not in claims data";
    case "duein":
      // creation_date is parsed from the sheet's "Reception Date" column (see
      // parse-claims.ts) - that's the due-in date this question checks against.
      return claim.creation_date ? `Reception date: ${claim.creation_date}` : "not in claims data";
    case "repairEndDate":
      return claim.repair_end_date ?? "not in claims data";
    case "concernOnRO":
    case "concernDesc":
      return findRawRowValue(claim.raw_row, CUSTOMER_CONCERN_ALIASES) ?? "not in claims data";
    default:
      return null;
  }
}
