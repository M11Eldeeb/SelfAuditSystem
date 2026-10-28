import { JIAD_DEALER_CODE_SUFFIX_MAP } from "@/lib/parse-claims";

/** "A7", "A7 MG Jeddah Heraa", "a7-..." -> A7 (only the dealer codes the portal knows). */
export function dealerCodeOf(label: string): string | null {
  const m = label.trim().toUpperCase().match(/^([A-Z]\d)(?![0-9A-Z])/);
  return m && JIAD_DEALER_CODE_SUFFIX_MAP[m[1]] ? m[1] : null;
}
