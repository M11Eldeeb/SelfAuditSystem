/**
 * Shared claim-date fields shown alongside parts across the Warranty Room
 * tables (do-not-scrap, supplier parts, parts to scrap) - same reasoning as
 * isSupplierPartOverdue: neither "First Submit Date" nor "Verification
 * Date" is a dedicated self_audit_claims column, so both come from raw_row.
 */
export function getFirstSubmitDate(rawRow: Record<string, unknown> | null | undefined): string | null {
  const v = rawRow?.["First Submit Date"];
  return v == null ? null : String(v).slice(0, 10);
}

/** Days between today and the claim's Verification Date - null when there's no verification date to compute from. */
export function computeHoldingPeriodDays(rawRow: Record<string, unknown> | null | undefined, today: Date = new Date()): number | null {
  const verificationRaw = rawRow?.["Verification Date"];
  if (!verificationRaw) return null;
  const verificationDate = new Date(String(verificationRaw));
  if (isNaN(verificationDate.getTime())) return null;
  return Math.floor((today.getTime() - verificationDate.getTime()) / 86400000);
}
