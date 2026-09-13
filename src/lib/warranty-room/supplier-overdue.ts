const OVERDUE_ELIGIBLE_STATUSES = new Set(["approved", "settled", "to be settled"]);
const OVERDUE_DAYS = 90;

/**
 * A supplier-reserved part is "overdue" once more than 90 days have passed
 * since its claim's Verification Date, but only once the claim itself has
 * reached a stage where that date is meaningful (Approved / Settled / To Be
 * Settled) - both fields come straight from raw_row since neither is a
 * dedicated self_audit_claims column.
 */
export function isSupplierPartOverdue(rawRow: Record<string, unknown> | null | undefined, today: Date = new Date()): boolean {
  if (!rawRow) return false;
  const status = String(rawRow["Status"] ?? "").trim().toLowerCase();
  if (!OVERDUE_ELIGIBLE_STATUSES.has(status)) return false;

  const verificationRaw = rawRow["Verification Date"];
  if (!verificationRaw) return false;
  const verificationDate = new Date(String(verificationRaw));
  if (isNaN(verificationDate.getTime())) return false;

  const daysElapsed = (today.getTime() - verificationDate.getTime()) / 86400000;
  return daysElapsed > OVERDUE_DAYS;
}
