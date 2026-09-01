/**
 * Ported from warranty_audit_app.html's "AUDIT FLAG SCORING" (itself ported
 * from an old Power BI DAX model). Each claim earns points across six risk
 * dimensions; the total prioritizes which claims get pulled into a
 * risk-based ("flagged") internal-audit sample.
 */
export const HIGH_RISK_LABOR_CODES = new Set([
  "121K009",
  "211A017",
  "221A001",
  "221A002",
  "221A003",
  "241D001",
  "241D006",
  "311A001",
  "651A001",
  "651A002",
  "651A003",
  "661A001",
  "661A002",
  "661A003",
  "111A001",
  "111B002",
  "111N001",
  "111N010",
  "111N011",
  "111P001",
  "121B001",
  "123A001",
]);

function daysBetween(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (isNaN(da) || isNaN(db)) return 0;
  return Math.round((db - da) / 86_400_000);
}

export type FlaggableClaim = {
  claim_amount: number | null;
  work_order_no: string | null;
  prior_approval: string | null;
  return_times: number | null;
  return_times_dealer: number | null;
  labor_code: string | null;
  creation_date: string | null;
  repair_end_date: string | null;
  dealer_submit_date: string | null;
};

export function buildWorkOrderCounts(claims: { work_order_no: string | null }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of claims) {
    if (!c.work_order_no) continue;
    counts.set(c.work_order_no, (counts.get(c.work_order_no) ?? 0) + 1);
  }
  return counts;
}

export function computeAuditFlag(claim: FlaggableClaim, workOrderCounts: Map<string, number>): number {
  let flag = 0;

  const amt = claim.claim_amount ?? 0;
  flag += amt > 1000 ? 5 : amt > 500 ? 2 : amt > 100 ? 1 : 0;

  const claimsPerWorkOrder = claim.work_order_no ? (workOrderCounts.get(claim.work_order_no) ?? 1) : 1;
  flag += claimsPerWorkOrder > 5 ? 3 : claimsPerWorkOrder > 3 ? 2 : claimsPerWorkOrder > 2 ? 1 : 0;

  flag += claim.prior_approval && claim.prior_approval.trim() ? 2 : 0;

  const returns = (claim.return_times ?? 0) + (claim.return_times_dealer ?? 0);
  flag += returns > 2 ? 2 : returns > 1 ? 1 : 0;

  flag += claim.labor_code && HIGH_RISK_LABOR_CODES.has(claim.labor_code.trim().toUpperCase()) ? 10 : 0;

  const receptionToEnd = daysBetween(claim.creation_date, claim.repair_end_date);
  const endToSubmit = daysBetween(claim.repair_end_date, claim.dealer_submit_date);
  const leadTime = receptionToEnd + endToSubmit;
  flag += leadTime > 40 ? 2 : leadTime > 30 ? 1.5 : leadTime > 20 ? 1 : leadTime > 10 ? 0.5 : 0;

  return Math.round(flag * 10) / 10;
}
