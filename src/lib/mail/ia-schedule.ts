import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMailStatus } from "@/lib/gmail";
import { composeMail } from "@/lib/mail/catalog";
import { loadPeople, loadTemplates, recipientsFor } from "@/lib/mail/people";
import { MAIL_KEYS, isMailEnabled, sendPlans, type PlannedMail } from "@/lib/mail/plans";
import { linkScheduledAudits, todayKsa } from "@/lib/ia-schedule";
import { auditDays } from "@/lib/ia-schedule-days";

const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const daysFrom = (today: string, d: string) => Math.round((Date.parse(d) - Date.parse(today)) / 86_400_000);

/**
 * The daily job's internal audit schedule mails to the officers:
 *  - for each planned audit with no audit list yet: 7 days before, 2 days before, and once the day after if it passed
 *    (each step sent once - the most urgent one that is due);
 *  - in the first two weeks of January (this year) and December (next year): when the year's schedule is empty or has
 *    audits without a date.
 */
export async function sendIaScheduleMails(origin: string): Promise<{ reminders: number; plan: string }> {
  if (!(await getMailStatus()) || !(await isMailEnabled(MAIL_KEYS.iaSchedule))) return { reminders: 0, plan: "switched off" };
  const today = todayKsa();
  await linkScheduledAudits();
  const admin = createAdminClient();
  const from = new Date(Date.parse(today) - 14 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(Date.parse(today) + 7 * 86_400_000).toISOString().slice(0, 10);
  const [{ data: slots }, { data: branches }, { data: holidays }, people, templates] = await Promise.all([
    admin.from("self_audit_ia_schedule").select("id, branch_id, planned_date, days").is("internal_audit_id", null).gte("planned_date", from).lte("planned_date", to),
    admin.from("self_audit_branches").select("id, name, active"),
    admin.from("self_audit_holidays").select("day").gte("day", from),
    loadPeople(),
    loadTemplates(),
  ]);
  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const holidaySet = new Set((holidays ?? []).map((h) => h.day));
  const plans: PlannedMail[] = [];

  for (const s of slots ?? []) {
    const left = daysFrom(today, s.planned_date!);
    const stage = left >= 3 ? "week" : left >= 0 ? "soon" : "overdue";
    const when = left > 2 ? `in ${left} days` : left === 2 ? "in 2 days" : left === 1 ? "tomorrow" : left === 0 ? "today" : "was planned and has passed";
    const branch = branchName.get(s.branch_id) ?? "";
    const t = templates.ia_schedule_reminder;
    plans.push({
      kind: "ia-schedule-reminder",
      key: `ia-schedule:${s.id}:${stage}`,
      branchId: s.branch_id,
      branchName: branch,
      ...recipientsFor(t, people, { to: people.officers }),
      ...composeMail(t, { branch, date: (() => {
          const range = auditDays(s.planned_date!, s.days, holidaySet);
          return range.length > 1 ? `${dayLabel(range[0])} to ${dayLabel(range[range.length - 1])} (${range.length} working days)` : dayLabel(range[0]);
        })(), when, link: `${origin}/admin/internal-audit?branch=${s.branch_id}&date=${s.planned_date}` }),
      label: `Internal audit ${when} - ${branch}`,
    });
  }

  // The year's plan: January for this year, December for next year.
  let plan = "not due";
  const month = Number(today.slice(5, 7));
  if ((month === 1 || month === 12) && Number(today.slice(8, 10)) <= 14) {
    const year = Number(today.slice(0, 4)) + (month === 12 ? 1 : 0);
    const { data: yearSlots } = await admin.from("self_audit_ia_schedule").select("planned_date").eq("year", year);
    const undated = (yearSlots ?? []).filter((s) => !s.planned_date).length;
    const lines = !yearSlots?.length ? [`- No audits planned yet for ${year}.`] : undated ? [`- ${undated} audit${undated === 1 ? " has" : "s have"} no date yet.`] : [];
    if (lines.length) {
      const t = templates.ia_plan_missing;
      plans.push({
        kind: "ia-plan-missing",
        key: `ia-plan:${year}:${today.slice(0, 7)}`,
        branchId: "",
        branchName: "All branches",
        ...recipientsFor(t, people, { to: people.officers }),
        ...composeMail(t, { year: String(year), list: lines.join("\n"), link: `${origin}/admin/internal-audit/schedule?year=${year}` }),
        label: `Internal audit schedule ${year}`,
      });
      plan = lines.join(" ");
    } else plan = "complete";
  }

  if (plans.length) await sendPlans(plans, null);
  return { reminders: (slots ?? []).length, plan };
}
