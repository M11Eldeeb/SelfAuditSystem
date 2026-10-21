import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMailStatus } from "@/lib/gmail";
import { composeMail } from "@/lib/mail/catalog";
import { monthLabel } from "@/lib/mail/template";
import { loadPeople, loadTemplates, recipientsFor } from "@/lib/mail/people";
import { MAIL_KEYS, isMailEnabled, sendPlans, type PlannedMail } from "@/lib/mail/plans";

type OpenClaim = { claim: string; workOrder: string | null; branch: string; closeDate: string | null };

const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const line = (c: OpenClaim) => `- ${c.claim} - ${c.workOrder ?? "no work order"} - ${c.branch} - ${c.closeDate ? `closes ${dayLabel(c.closeDate)}` : "close date not entered"}`;
/** Today in Saudi time, YYYY-MM-DD. */
const todayKsa = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);

/** Rejected claims (claims export status "Rejected...") not handled yet (no outcome, or appeal submitted) and not closed yet. */
async function openRejectedClaims(today: string): Promise<OpenClaim[]> {
  const admin = createAdminClient();
  const [{ data: claims }, { data: branches }] = await Promise.all([
    admin.from("self_audit_claims").select("id, branch_id, claim_number, work_order_no").like("raw_row->>Status", "Rejected%").limit(2000),
    admin.from("self_audit_branches").select("id, name"),
  ]);
  const ids = (claims ?? []).map((c) => c.id);
  const { data: reviews } = ids.length ? await admin.from("self_audit_rejected_claim_reviews").select("claim_id, status, close_date").in("claim_id", ids) : { data: [] };
  const reviewOf = new Map((reviews ?? []).map((r) => [r.claim_id, r]));
  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));
  return (claims ?? [])
    .map((c) => ({ c, r: reviewOf.get(c.id) }))
    .filter(({ r }) => (!r?.status || r.status === "appeal_submitted") && (!r?.close_date || r.close_date >= today))
    .map(({ c, r }) => ({ claim: c.claim_number, workOrder: c.work_order_no, branch: branchName.get(c.branch_id) ?? "", closeDate: r?.close_date ?? null }))
    .sort((a, b) => (a.closeDate ?? "9999").localeCompare(b.closeDate ?? "9999"));
}

/**
 * The daily job's rejected-claims mails to the officers:
 *  - at the start of every month (first run of the month - sent once, keyed by the month): how many rejected claims are
 *    open and when each closes;
 *  - on Thursday, when open claims close on the Friday or Saturday after (sent once per weekend).
 */
export async function sendRejectedClaimMails(origin: string): Promise<{ monthly: string; weekend: string }> {
  if (!(await getMailStatus()) || !(await isMailEnabled(MAIL_KEYS.rejectedClaims))) return { monthly: "switched off", weekend: "switched off" };
  const today = todayKsa();
  const [open, people, templates] = await Promise.all([openRejectedClaims(today), loadPeople(), loadTemplates()]);
  const link = `${origin}/admin/dashboard?tab=reconciliation`;
  const plans: PlannedMail[] = [];
  const result = { monthly: "not due", weekend: "not due" };

  if (Number(today.slice(8, 10)) <= 7) {
    const t = templates.rejected_monthly;
    const n = open.length;
    plans.push({
      kind: "rejected-claims-monthly",
      key: `rejected-claims-monthly:${today.slice(0, 7)}`,
      branchId: "",
      branchName: "All branches",
      ...recipientsFor(t, people, { to: people.officers }),
      ...composeMail(t, {
        month: monthLabel(`${today.slice(0, 7)}-01`),
        count: `${n} claim${n === 1 ? "" : "s"}`,
        are: n === 1 ? "is" : "are",
        list: n ? open.map(line).join("\n") : "Nothing open - every rejected claim is handled.",
        link,
      }),
      label: "Rejected claims - monthly summary",
    });
    result.monthly = `${n} open`;
  }

  // Thursday (Saudi time): reminder for claims closing on Friday or Saturday.
  if (new Date(`${today}T00:00:00Z`).getUTCDay() === 4) {
    const fri = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const sat = new Date(Date.parse(`${today}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);
    const closing = open.filter((c) => c.closeDate === fri || c.closeDate === sat);
    if (closing.length) {
      const t = templates.rejected_weekend;
      const n = closing.length;
      plans.push({
        kind: "rejected-claims-weekend",
        key: `rejected-claims-weekend:${fri}`,
        branchId: "",
        branchName: "All branches",
        ...recipientsFor(t, people, { to: people.officers }),
        ...composeMail(t, { count: `${n} rejected claim${n === 1 ? "" : "s"}`, closes: n === 1 ? "closes" : "close", list: closing.map(line).join("\n"), link }),
        label: "Rejected claims - closing on the weekend",
      });
      result.weekend = `${n} closing`;
    } else result.weekend = "nothing closing on the weekend";
  }

  if (plans.length) await sendPlans(plans, null);
  return result;
}
