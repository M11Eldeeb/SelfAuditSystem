import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { findSentMail, sendMail, type MailAttachment } from "@/lib/gmail";
import { AUDIT_CYCLE_DEADLINE_DAYS } from "@/lib/cycle";
import { composeMail } from "@/lib/mail/catalog";
import { calendarDaysBetween, dateLabel, monthLabel, reminderMilestone } from "@/lib/mail/template";
import { loadPeople, loadTemplates, recipientsFor } from "@/lib/mail/people";

/**
 * The portal's automatic e-mails, as plans: who each mail goes to, what it says and under which
 * "never twice" key. A plan is only a description - sendPlans() sends it, and the Email settings page shows
 * plans as a preview before anything is switched on. The wording, copies and reminder days all come from the
 * templates an officer can edit under Settings -> Email settings (see catalog.ts for the built-in versions).
 */

export const MAIL_KEYS = {
  selfAuditReminder: "self_audit_reminder",
  flaggedParts: "flagged_parts",
  podium: "podium_congrats",
  internalAuditNotice: "internal_audit_notice",
  scrapEvidence: "scrap_evidence_mails",
} as const;

export type PlannedMail = {
  kind: string;
  /** Sent once only: a mail with this key that already went out is skipped. */
  key: string;
  branchId: string;
  branchName: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  html: string;
  /** Dedupe key of the mail this one is a reply to (same thread), if it was sent. */
  replyToKey?: string;
  /** Short line for the preview: which reminder / which mail. */
  label: string;
  attachments?: MailAttachment[];
};

const admin = () => createAdminClient();
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export async function isMailEnabled(key: string): Promise<boolean> {
  const { data } = await admin().from("self_audit_mail_settings").select("enabled").eq("key", key).maybeSingle();
  return data?.enabled === true;
}

// ---- 1. self audit ready (sent by the "Send mail" button after a cycle is generated) ------------------

export async function planSelfAuditReady(cycleId: string, origin: string): Promise<PlannedMail[]> {
  const { data: cycle } = await admin().from("self_audit_audit_cycles").select("id, cycle_month, deadline_at").eq("id", cycleId).maybeSingle();
  if (!cycle) return [];
  const [{ data: assignments }, people, templates] = await Promise.all([
    admin().from("self_audit_audit_assignments").select("branch_id").eq("cycle_id", cycleId),
    loadPeople(),
    loadTemplates(),
  ]);
  const counts = new Map<string, number>();
  for (const a of assignments ?? []) counts.set(a.branch_id, (counts.get(a.branch_id) ?? 0) + 1);
  if (counts.size === 0) return [];
  const t = templates.ready;

  // One mail for everybody: all the admins of the branches that were assigned claims, in To. Branches can be
  // assigned different numbers (some have fewer claims to pick from), so the text says "up to N" in that case.
  const branchIds = [...counts.keys()];
  const max = Math.max(...counts.values());
  const allSame = [...counts.values()].every((n) => n === max);
  const mail = composeMail(t, {
    month: monthLabel(cycle.cycle_month),
    claims: `${allSame ? "" : "up to "}${max} ${plural(max, "claim", "claims")}`,
    have: allSame ? plural(max, "has", "have") : "have",
    deadline: cycle.deadline_at ? dateLabel(cycle.deadline_at) : "the deadline",
    cycle_days: String(AUDIT_CYCLE_DEADLINE_DAYS),
    link: `${origin}/audit`,
  });
  const to = [...new Set(branchIds.flatMap((id) => people.adminsByBranch.get(id) ?? []))];
  return [
    {
      kind: "self-audit-ready",
      key: `self-audit-ready:${cycleId}`,
      branchId: "all",
      branchName: `All branches (${branchIds.length})`,
      ...recipientsFor(t, people, { to, branchIds }),
      ...mail,
      label: "Self audit is ready",
    },
  ];
}

// ---- 2. self-audit reminders (7, 3 and 1 day before the deadline, or the days set in the template) ------------

export async function planSelfAuditReminders(origin: string, now = new Date()): Promise<PlannedMail[]> {
  const { data: cycles } = await admin().from("self_audit_audit_cycles").select("id, cycle_month, deadline_at").eq("status", "open");
  if (!cycles?.length) return [];
  const [people, templates] = await Promise.all([loadPeople(), loadTemplates()]);
  const t = templates.reminder;
  const plans: PlannedMail[] = [];

  for (const cycle of cycles) {
    if (!cycle.deadline_at) continue;
    const daysLeft = calendarDaysBetween(now, new Date(cycle.deadline_at));
    const milestone = reminderMilestone(daysLeft, t.milestones);
    if (!milestone) continue;

    const [{ data: assignments }, { data: ops }] = await Promise.all([
      admin().from("self_audit_audit_assignments").select("branch_id, status").eq("cycle_id", cycle.id),
      admin().from("self_audit_branch_operation_progress").select("branch_id, status").eq("cycle_id", cycle.id),
    ]);
    const byBranch = new Map<string, { total: number; open: number }>();
    for (const a of assignments ?? []) {
      const s = byBranch.get(a.branch_id) ?? { total: 0, open: 0 };
      s.total += 1;
      if (a.status === "not_started" || a.status === "in_progress") s.open += 1;
      byBranch.set(a.branch_id, s);
    }
    const month = monthLabel(cycle.cycle_month);

    for (const [branchId, s] of byBranch) {
      const progress = (ops ?? []).find((o) => o.branch_id === branchId);
      const checklistOpen = !progress || progress.status === "not_started";
      if (s.open === 0 && !checklistOpen) continue; // finished: gets nothing

      const readyKey = `self-audit-ready:${cycle.id}`;
      const original = await findSentMail(readyKey);
      const branch = people.branchName.get(branchId) ?? "Branch";
      const mail = composeMail(t, {
        month,
        branch,
        days_left: String(daysLeft),
        days_word: plural(daysLeft, "day", "days"),
        deadline: dateLabel(cycle.deadline_at),
        open: String(s.open),
        total: String(s.total),
        checklist: checklistOpen ? ", and the branch operations checklist is not submitted" : "",
        link: `${origin}/audit`,
      });
      plans.push({
        kind: "self-audit-reminder",
        key: `self-audit-reminder:${cycle.id}:${branchId}:${milestone}`,
        branchId,
        branchName: branch,
        ...recipientsFor(t, people, { to: people.adminsByBranch.get(branchId) ?? [], branchId }),
        ...mail,
        // In the same thread as the "ready" mail the branch got, so the subject carries on from it.
        subject: original ? `Re: ${original.subject}` : mail.subject,
        replyToKey: original ? readyKey : undefined,
        label: `Reminder - ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`,
      });
    }
  }
  return plans;
}

// ---- 3. flagged parts (scrap evidence), then its reminders --------------------------------------------------

export async function planFlaggedParts(origin: string, opts: { now?: Date; only?: "initial" } = {}): Promise<PlannedMail[]> {
  const now = opts.now ?? new Date();
  const { data: cycle } = await admin()
    .from("self_audit_warranty_room_cycles")
    .select("id, cycle_month, created_at")
    .order("cycle_month", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!cycle) return [];

  const [{ data: counts }, { data: evidence }, people, templates] = await Promise.all([
    admin().rpc("get_flagged_part_counts", { p_cycle_id: cycle.id }),
    admin().from("self_audit_destroy_evidence").select("branch_id, status").eq("cycle_id", cycle.id),
    loadPeople(),
    loadTemplates(),
  ]);
  const first = templates.flagged;
  const reminder = templates.flagged_reminder;
  const deadlineAt = new Date(new Date(cycle.created_at).getTime() + first.deadlineDays * 86_400_000);
  const daysLeft = calendarDaysBetween(now, deadlineAt);
  const evidenceStatus = new Map((evidence ?? []).map((e) => [e.branch_id, e.status]));
  const month = monthLabel(cycle.cycle_month);
  const plans: PlannedMail[] = [];

  for (const c of counts ?? []) {
    const parts = Number(c.parts);
    if (parts < 1 || !people.activeBranches.has(c.branch_id)) continue; // closed branches are left out
    const status = evidenceStatus.get(c.branch_id);
    if (status === "submitted" || status === "sent") continue; // already handed in: nothing to ask for
    const branch = people.branchName.get(c.branch_id) ?? "Branch";
    const vars = {
      branch,
      month,
      parts: `${parts} ${plural(parts, "part", "parts")}`,
      is: plural(parts, "is", "are"),
      them: plural(parts, "it", "them"),
      deadline: dateLabel(deadlineAt.toISOString()),
      deadline_days: String(first.deadlineDays),
      days_left: String(daysLeft),
      days_word: plural(daysLeft, "day", "days"),
      link: `${origin}/audit/warranty-room`,
    };
    // A separate mail for every admin of the branch (not one mail with all of them in To).
    const admins = people.adminsByBranch.get(c.branch_id) ?? [];
    if (admins.length === 0) {
      plans.push({
        kind: "flagged-parts",
        key: `flagged-parts:${cycle.id}:${c.branch_id}:none`,
        branchId: c.branch_id,
        branchName: branch,
        to: [],
        cc: [],
        ...composeMail(first, vars),
        label: "Parts flagged to scrap",
      });
      continue;
    }

    for (const admin of admins) {
      const initialKey = `flagged-parts:${cycle.id}:${c.branch_id}:${admin}`;
      const original = await findSentMail(initialKey);

      if (!original) {
        // Only while the deadline is still ahead: an old cycle never gets a first mail now.
        if (daysLeft < 1) continue;
        plans.push({
          kind: "flagged-parts",
          key: initialKey,
          branchId: c.branch_id,
          branchName: branch,
          ...recipientsFor(first, people, { to: [admin], branchId: c.branch_id }),
          ...composeMail(first, vars),
          label: `Parts flagged to scrap - ${admin}`,
        });
        continue;
      }

      if (opts.only === "initial") continue;
      const milestone = reminderMilestone(daysLeft, reminder.milestones);
      if (!milestone) continue;
      plans.push({
        kind: "flagged-parts-reminder",
        key: `flagged-parts-reminder:${cycle.id}:${c.branch_id}:${admin}:${milestone}`,
        branchId: c.branch_id,
        branchName: branch,
        ...recipientsFor(reminder, people, { to: [admin], branchId: c.branch_id }),
        ...composeMail(reminder, vars),
        subject: `Re: ${original.subject}`,
        replyToKey: initialKey,
        label: `Reminder - ${daysLeft} day${daysLeft === 1 ? "" : "s"} left - ${admin}`,
      });
    }
  }
  return plans;
}

// ---- 4. the podium congratulations ------------------------------------------------------------------------------

/**
 * Sent the working morning after the LAST branch result of a self-audit cycle is finalized (the daily job
 * runs at about 09:00, Sunday to Thursday). Goes to every branch admin. Only a cycle finalized in the last 10
 * days is considered, so switching the mail on never congratulates an old cycle.
 */
export async function planPodium(origin: string, now = new Date()): Promise<PlannedMail[]> {
  const { data: cycles } = await admin().from("self_audit_audit_cycles").select("id, cycle_month").order("cycle_month", { ascending: false }).limit(2);
  const plans: PlannedMail[] = [];
  const [people, templates] = await Promise.all([loadPeople(), loadTemplates()]);
  const t = templates.podium;

  for (const cycle of cycles ?? []) {
    const [{ data: assignments }, { data: results }] = await Promise.all([
      admin().from("self_audit_audit_assignments").select("branch_id").eq("cycle_id", cycle.id),
      admin().from("self_audit_audit_results").select("branch_id, score_pct, finalized_at").eq("cycle_id", cycle.id),
    ]);
    const assigned = new Set((assignments ?? []).map((a) => a.branch_id));
    if (assigned.size === 0 || !results?.length) continue;
    const finalized = new Set(results.map((r) => r.branch_id));
    if (![...assigned].every((id) => finalized.has(id))) continue; // someone is still to be finalized

    const last = new Date(Math.max(...results.map((r) => new Date(r.finalized_at).getTime())));
    const since = calendarDaysBetween(last, now);
    if (since < 1 || since > 10) continue; // not before the next working morning; nothing old

    const top = results
      .filter((r) => people.activeBranches.has(r.branch_id))
      .map((r) => ({ name: people.branchName.get(r.branch_id)!, avg: Math.round(Number(r.score_pct) * 10) / 10 }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 3);
    if (top.length === 0) continue;

    const mail = composeMail(
      t,
      { month: monthLabel(cycle.cycle_month), link: `${origin}/audit/results/self-audit` },
      top.map((x, i) => ({ place: (i + 1) as 1 | 2 | 3, name: x.name, pct: `${x.avg}%` }))
    );
    plans.push({
      kind: "podium",
      key: `podium:${cycle.id}`,
      branchId: "all",
      branchName: "All branches",
      ...recipientsFor(t, people, { to: [...new Set([...people.adminsByBranch.values()].flat())] }),
      ...mail,
      label: `Podium - ${monthLabel(cycle.cycle_month)}`,
    });
  }
  return plans;
}

// ---- sending ------------------------------------------------------------------------------------------------------

export type SendOutcome = { branchName: string; label: string; status: "sent" | "already-sent" | "no-recipients" | "failed"; error?: string };

/** Sends each plan (one after another), as a reply where it belongs to a thread. Never throws. */
export async function sendPlans(plans: PlannedMail[], sentBy: string | null): Promise<SendOutcome[]> {
  const outcomes: SendOutcome[] = [];
  for (const p of plans) {
    const base = { branchName: p.branchName, label: p.label };
    if (p.to.length === 0) {
      outcomes.push({ ...base, status: "no-recipients", error: "No branch admin account for this branch." });
      continue;
    }
    const reply = p.replyToKey ? await findSentMail(p.replyToKey) : null;
    const result = await sendMail({
      kind: p.kind,
      to: p.to,
      cc: p.cc,
      subject: p.subject,
      text: p.text,
      html: p.html,
      attachments: p.attachments,
      sentBy,
      dedupeKey: p.key,
      reply: reply ? { threadId: reply.threadId, messageId: reply.messageId } : undefined,
    });
    if (!result.ok) outcomes.push({ ...base, status: "failed", error: result.error });
    else outcomes.push({ ...base, status: result.skipped ? "already-sent" : "sent" });
  }
  return outcomes;
}
