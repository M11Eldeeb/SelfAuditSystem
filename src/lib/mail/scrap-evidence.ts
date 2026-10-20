import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMailStatus } from "@/lib/gmail";
import { composeMail } from "@/lib/mail/catalog";
import { monthLabel } from "@/lib/mail/template";
import { loadPeople, loadTemplates, recipientsFor } from "@/lib/mail/people";
import { MAIL_KEYS, isMailEnabled, sendPlans, type PlannedMail } from "@/lib/mail/plans";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

async function context(cycleId: string, branchId: string) {
  const admin = createAdminClient();
  const [{ data: cycle }, { data: branch }] = await Promise.all([
    admin.from("self_audit_warranty_room_cycles").select("cycle_month").eq("id", cycleId).maybeSingle(),
    admin.from("self_audit_branches").select("name").eq("id", branchId).maybeSingle(),
  ]);
  return { month: cycle ? monthLabel(cycle.cycle_month) : "", branchName: branch?.name ?? "Branch" };
}

/**
 * Scrap (destroy) evidence e-mails: to the officers when a branch submits its videos, to the branch's admins when an officer
 * approves them. Both follow the "scrap_evidence_mails" switch and never break the action that triggered them.
 */
export async function mailScrapEvidence(
  event: "submitted" | "approved",
  input: { cycleId: string; branchId: string; by: string; origin: string; userId: string; scrapped?: number }
): Promise<void> {
  try {
    if (!(await getMailStatus()) || !(await isMailEnabled(MAIL_KEYS.scrapEvidence))) return;
    const admin = createAdminClient();
    const [{ month, branchName }, people, templates] = await Promise.all([context(input.cycleId, input.branchId), loadPeople(), loadTemplates()]);
    const at = new Date().toISOString();
    let plan: PlannedMail;
    if (event === "submitted") {
      const t = templates.scrap_evidence_submitted;
      const { count } = await admin.from("self_audit_destroy_evidence_videos").select("id", { count: "exact", head: true }).eq("cycle_id", input.cycleId).eq("branch_id", input.branchId);
      plan = {
        kind: "scrap-evidence-submitted",
        key: `scrap-evidence-submitted:${input.cycleId}:${input.branchId}:${at}`,
        branchId: input.branchId,
        branchName,
        ...recipientsFor(t, people, { to: people.officers, branchId: input.branchId }),
        ...composeMail(t, { branch: branchName, month, by: input.by, videos: plural(count ?? 0, "video"), link: `${input.origin}/admin/warranty-room/destroy-evidence/${input.cycleId}` }),
        label: "Scrap evidence submitted",
      };
    } else {
      const t = templates.scrap_evidence_approved;
      plan = {
        kind: "scrap-evidence-approved",
        key: `scrap-evidence-approved:${input.cycleId}:${input.branchId}`,
        branchId: input.branchId,
        branchName,
        ...recipientsFor(t, people, { to: people.adminsByBranch.get(input.branchId) ?? [], branchId: input.branchId }),
        ...composeMail(t, { branch: branchName, month, by: input.by, parts: plural(input.scrapped ?? 0, "part"), link: `${input.origin}/audit/warranty-room` }),
        label: "Scrap evidence approved",
      };
    }
    if (plan.to.length) await sendPlans([plan], input.userId);
  } catch (e) {
    console.error("Scrap evidence mail failed:", e instanceof Error ? e.message : e);
  }
}
