import { baseJobCard } from "@/lib/dashboard/kpis";

/** Reception questions are about the job card itself, so every claim on one WIP shares their answers. */
export const SHARED_WIP_DEPARTMENT = "reception";

/** The repair agreement question is asked last in Reception. */
export const RECEPTION_LAST_QUESTION_ID = "agreement";

/**
 * Groups an internal audit's claims by WIP (base job card: "HER-12345-2" and
 * "HER-12345" are the same WIP) and returns, for every claim, the first claim
 * of its WIP in audit order - or null when it is the first / only one.
 */
export function firstClaimOfWip(
  internalClaims: { id: string; claim_id: string }[],
  workOrderByClaimId: Map<string, string | null>
): Map<string, { id: string; index: number } | null> {
  const first = new Map<string, { id: string; index: number }>();
  const result = new Map<string, { id: string; index: number } | null>();
  internalClaims.forEach((ic, index) => {
    const wip = baseJobCard(workOrderByClaimId.get(ic.claim_id) ?? null);
    if (!wip) {
      result.set(ic.id, null);
      return;
    }
    const lead = first.get(wip);
    if (lead) result.set(ic.id, lead);
    else {
      first.set(wip, { id: ic.id, index });
      result.set(ic.id, null);
    }
  });
  return result;
}

/** Reception questions in the order the internal audit asks them: the repair agreement moved to the end. */
export function orderReceptionQuestions<T extends { id: string }>(questions: T[]): T[] {
  const last = questions.filter((q) => q.id === RECEPTION_LAST_QUESTION_ID);
  return [...questions.filter((q) => q.id !== RECEPTION_LAST_QUESTION_ID), ...last];
}
