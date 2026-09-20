/**
 * A claim in one of these states isn't a real, settled warranty case to
 * sample into either self-audit cycle generation or internal audit sampling
 * - confirmed against real data (raw_row->>'Status' spellings exactly as the
 * source export uses them): "Draft saved" never got submitted, "Rejected"/
 * "Closed" are dead regardless of parts. Same reasoning get_do_not_scrap_claims
 * already uses for which claims are worth flagging, applied here at
 * sampling time instead of after the fact.
 */
const EXCLUDED_CLAIM_STATUSES = new Set(["Draft saved", "Rejected", "Closed"]);

/**
 * Any status containing "returned" (case-insensitive) is excluded too, not
 * just one spelling ("Returned from chief agent") - the export could
 * introduce "Returned to dealer" or similar later and this should catch it
 * without needing another hardcoded string added by hand.
 */
export function isExcludedClaimStatus(status: string): boolean {
  return EXCLUDED_CLAIM_STATUSES.has(status) || status.toLowerCase().includes("returned");
}
