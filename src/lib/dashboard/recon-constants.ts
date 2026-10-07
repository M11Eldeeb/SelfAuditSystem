/** Reconciliation is tracked from this SAIC settlement order on; earlier ones are ignored. */
export const RECON_FROM_ORDER = "CRSA6P20261001";

/** Settlement orders end in their date as yyyyMMdd: "CRSA6P20261001" -> "1 Oct 2026". */
export function settlementDate(order: string): string | null {
  const m = order.match(/(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Compares settlement orders by their trailing date, so a prefix change can't reorder them. */
export function isOnOrAfterReconStart(order: string): boolean {
  const date = (o: string) => o.match(/(\d{8})$/)?.[1] ?? "";
  return date(order) >= date(RECON_FROM_ORDER);
}
