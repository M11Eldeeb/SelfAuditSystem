// Shared by the browser and the server - no "server-only" here on purpose.

/** Feature flag (self_audit_feature_flags) that unlocks the diary for branch admins. */
export const REJECTED_CLAIMS_FLAG = "rejected_claims_branch_admins";
export const REJECTED_BUCKET = "rejected-claims-files";
export const REJECTED_MAX_FILES = 5;
export const REJECTED_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const REJECTED_REASON_MAX = 2000;
export const REJECTED_COMMENT_MAX = 2000;
export const REJECTED_PAGE_SIZE = 50;

export type WorkOrderResult = { value: string; error?: undefined } | { value?: undefined; error: string };

/**
 * Turns what a person typed into the stored work order number. Workshops often
 * type only the number ("35698"); the work order is then "<branch code>-<number>"
 * ("HER-35698"). A prefix that was typed is kept as typed (just upper-cased), so
 * "her-35698" and "HER35698" both become "HER-35698", and "MRB-27636-2" stays.
 */
export function normalizeWorkOrder(input: string, branchCode: string): WorkOrderResult {
  const code = branchCode.trim().toUpperCase();
  let wo = input.trim().toUpperCase().replace(/\s+/g, "").replace(/[_–—]/g, "-");
  if (!wo) return { error: "Enter the work order number." };

  if (/^\d/.test(wo)) {
    wo = `${code}-${wo}`; // only digits typed: add the branch code
  } else if (code && wo.startsWith(code) && /^\d/.test(wo.slice(code.length))) {
    wo = `${code}-${wo.slice(code.length)}`; // "HER35698" -> "HER-35698"
  }

  if (wo.length > 40) return { error: "The work order number is too long." };
  if (!/^[A-Z0-9][A-Z0-9\-/.]*$/.test(wo)) return { error: "The work order number can only contain letters, numbers and - / ." };
  if (/^[A-Z]+-?$/.test(wo)) return { error: "Enter the work order number, not just the branch code." };
  return { value: wo };
}
