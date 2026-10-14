import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { findSentMail, sendMail, type MailAttachment } from "@/lib/gmail";
import { PODIUM_STANDING_CC, WARRANTY_HEAD_EMAIL } from "@/lib/mail/contacts";
import { AUDIT_CYCLE_DEADLINE_DAYS } from "@/lib/cycle";
import { calendarDaysBetween, dateLabel, monthLabel, reminderMilestone, renderMail } from "@/lib/mail/template";

/**
 * The portal's automatic e-mails, as plans: who each mail goes to, what it says and under which
 * "never twice" key. A plan is only a description - sendPlans() sends it, and the Email settings page shows
 * plans as a preview before anything is switched on.
 */

export { WARRANTY_HEAD_EMAIL };
export const FLAGGED_DEADLINE_DAYS = 15; // from the warranty room cycle's creation; evidence can still be uploaded later
export const MAIL_KEYS = {
  selfAuditReminder: "self_audit_reminder",
  flaggedParts: "flagged_parts",
  podium: "podium_congrats",
  internalAuditNotice: "internal_audit_notice",
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
const WHERE = "under Warranty Room → Submit destroy evidence";

/** The approved wording of each mail. Used for real sends and for the "send me a test" samples alike. */
export const mailContent = {
  selfAuditReady(v: { month: string; claims: number; deadline: string | null; origin: string }) {
    return renderMail([
      { type: "p", text: `The ${v.month} self audit is now open. ${v.claims} ${plural(v.claims, "claim has", "claims have")} been assigned to you, and the branch operations checklist is also waiting.` },
      { type: "p", text: `Please sign in, review each claim and submit before ${v.deadline ?? "the deadline"}${v.deadline ? ` (${AUDIT_CYCLE_DEADLINE_DAYS} days)` : ""}.` },
      { type: "link", label: "Open the portal", url: `${v.origin}/audit` },
      { type: "note", text: "Automated mail - No Reply" },
    ]);
  },
  selfAuditReminder(v: { month: string; daysLeft: number; deadline: string; open: number; total: number; checklistOpen: boolean; origin: string }) {
    return renderMail([
      { type: "p", text: `Reminder: ${v.daysLeft} ${plural(v.daysLeft, "day", "days")} left.` },
      {
        type: "p",
        text: `Your ${v.month} self audit closes on ${v.deadline}. ${v.open} of ${v.total} claims are still not submitted${v.checklistOpen ? ", and the branch operations checklist is not submitted" : ""}.`,
      },
      { type: "note", text: "Failing to submit before the deadline date would make the unanswered questions automatically zero." },
      { type: "link", label: "Open the portal", url: `${v.origin}/audit` },
    ]);
  },
  flaggedParts(v: { branch: string; month: string; parts: number; deadline: string; origin: string }) {
    const them = plural(v.parts, "it", "them");
    return renderMail(
      [
        { type: "p", text: `${v.parts} ${plural(v.parts, "part", "parts")} at your branch ${plural(v.parts, "is", "are")} flagged to be scrapped in the ${v.month} cycle.` },
        { type: "p", text: `Please destroy ${them}, record one or more videos showing it, and upload the videos in the portal ${WHERE}. The flagged list is on the same page.` },
        { type: "p", text: `The deadline is ${v.deadline} (${FLAGGED_DEADLINE_DAYS} days from the start of the cycle).` },
        { type: "link", label: "Open the portal", url: `${v.origin}/audit/warranty-room` },
      ],
      { greeting: `Dear ${v.branch} team,` }
    );
  },
  podium(v: { month: string; top: { name: string; avg: number }[]; origin: string }) {
    return renderMail([
      { type: "p", text: `Congratulations to this month’s top-performing branches in the ${v.month} self audit:` },
      { type: "podium", entries: v.top.map((t, i) => ({ place: (i + 1) as 1 | 2 | 3, name: t.name, pct: `${t.avg}%` })) },
      { type: "p", text: "Great work maintaining such high standards in claims documentation and compliance." },
      { type: "p", text: "To every other branch: thank you for your effort this cycle. We encourage you to keep pushing and aim for a podium finish next month." },
      { type: "link", label: "Full results", url: `${v.origin}/audit/results/self-audit` },
    ]);
  },
  flaggedReminder(v: { branch: string; month: string; parts: number; daysLeft: number; deadline: string; origin: string }) {
    return renderMail(
      [
        { type: "p", text: `Reminder: ${v.daysLeft} ${plural(v.daysLeft, "day", "days")} left to submit your destroy evidence for the ${v.month} cycle (deadline ${v.deadline}).` },
        { type: "p", text: `${v.parts} ${plural(v.parts, "part", "parts")} at your branch ${plural(v.parts, "is", "are")} still flagged to be scrapped. Please upload the videos ${WHERE}.` },
        { type: "link", label: "Open the portal", url: `${v.origin}/audit/warranty-room` },
      ],
      { greeting: `Dear ${v.branch} team,` }
    );
  },
};

export async function isMailEnabled(key: string): Promise<boolean> {
  const { data } = await admin().from("self_audit_mail_settings").select("enabled").eq("key", key).maybeSingle();
  return data?.enabled === true;
}

// A real-looking address only: a test account such as "c@c" is left out instead of making the whole mail fail.
const VALID_EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

export type People = {
  officers: string[];
  adminsByBranch: Map<string, string[]>;
  managersByBranch: Map<string, string[]>;
  branchName: Map<string, string>;
};

export async function loadPeople(): Promise<People> {
  const [{ data: users }, { data: contacts }, { data: branches }] = await Promise.all([
    admin().from("self_audit_users").select("email, role, branch_id"),
    admin().from("self_audit_branch_contacts").select("branch_id, email"),
    admin().from("self_audit_branches").select("id, name"),
  ]);
  const adminsByBranch = new Map<string, string[]>();
  for (const u of users ?? []) {
    if (u.role === "branch_admin" && u.branch_id && u.email && VALID_EMAIL.test(u.email)) adminsByBranch.set(u.branch_id, [...(adminsByBranch.get(u.branch_id) ?? []), u.email.toLowerCase()]);
  }
  const managersByBranch = new Map<string, string[]>();
  for (const c of contacts ?? []) managersByBranch.set(c.branch_id, [...(managersByBranch.get(c.branch_id) ?? []), c.email.toLowerCase()]);
  return {
    officers: [...new Set((users ?? []).filter((u) => u.role === "officer" && u.email && VALID_EMAIL.test(u.email)).map((u) => u.email.toLowerCase()))],
    adminsByBranch,
    managersByBranch,
    branchName: new Map((branches ?? []).map((b) => [b.id, b.name])),
  };
}

/** Copied on the self-audit and internal-audit mails: the warranty head, every officer and the branch's service managers. */
export const selfAuditCc = (people: People, branchId: string) => [WARRANTY_HEAD_EMAIL, ...people.officers, ...(people.managersByBranch.get(branchId) ?? [])];

// ---- 1. self audit ready (sent by the "Send mail" button after a cycle is generated) ------------------

export async function planSelfAuditReady(cycleId: string, origin: string): Promise<PlannedMail[]> {
  const { data: cycle } = await admin().from("self_audit_audit_cycles").select("id, cycle_month, deadline_at").eq("id", cycleId).maybeSingle();
  if (!cycle) return [];
  const [{ data: assignments }, people] = await Promise.all([
    admin().from("self_audit_audit_assignments").select("branch_id").eq("cycle_id", cycleId),
    loadPeople(),
  ]);
  const counts = new Map<string, number>();
  for (const a of assignments ?? []) counts.set(a.branch_id, (counts.get(a.branch_id) ?? 0) + 1);
  const month = monthLabel(cycle.cycle_month);

  return [...counts.entries()].map(([branchId, n]) => {
    const { text, html } = mailContent.selfAuditReady({ month, claims: n, deadline: cycle.deadline_at ? dateLabel(cycle.deadline_at) : null, origin });
    return {
      kind: "self-audit-ready",
      key: `self-audit-ready:${cycleId}:${branchId}`,
      branchId,
      branchName: people.branchName.get(branchId) ?? "Branch",
      to: people.adminsByBranch.get(branchId) ?? [],
      cc: selfAuditCc(people, branchId),
      subject: `${month} self audit is ready`,
      text,
      html,
      label: "Self audit is ready",
    };
  });
}

// ---- 2. self-audit reminders (7, 3 and 1 day before the deadline) -----------------------------------------

export async function planSelfAuditReminders(origin: string, now = new Date()): Promise<PlannedMail[]> {
  const { data: cycles } = await admin().from("self_audit_audit_cycles").select("id, cycle_month, deadline_at").eq("status", "open");
  if (!cycles?.length) return [];
  const people = await loadPeople();
  const plans: PlannedMail[] = [];

  for (const cycle of cycles) {
    if (!cycle.deadline_at) continue;
    const daysLeft = calendarDaysBetween(now, new Date(cycle.deadline_at));
    const milestone = reminderMilestone(daysLeft);
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

      const readyKey = `self-audit-ready:${cycle.id}:${branchId}`;
      const original = await findSentMail(readyKey);
      const deadline = dateLabel(cycle.deadline_at);
      const { text, html } = mailContent.selfAuditReminder({ month, daysLeft, deadline, open: s.open, total: s.total, checklistOpen, origin });
      plans.push({
        kind: "self-audit-reminder",
        key: `self-audit-reminder:${cycle.id}:${branchId}:${milestone}`,
        branchId,
        branchName: people.branchName.get(branchId) ?? "Branch",
        to: people.adminsByBranch.get(branchId) ?? [],
        cc: selfAuditCc(people, branchId),
        // In the same thread as the "ready" mail the branch got, so the subject carries on from it.
        subject: original ? `Re: ${original.subject}` : `Reminder: ${month} self audit closes in ${daysLeft} day${daysLeft === 1 ? "" : "s"} - ${people.branchName.get(branchId) ?? ""}`,
        text,
        html,
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
  const deadlineAt = new Date(new Date(cycle.created_at).getTime() + FLAGGED_DEADLINE_DAYS * 86_400_000);
  const daysLeft = calendarDaysBetween(now, deadlineAt);

  const [{ data: counts }, { data: evidence }, people] = await Promise.all([
    admin().rpc("get_flagged_part_counts", { p_cycle_id: cycle.id }),
    admin().from("self_audit_destroy_evidence").select("branch_id, status").eq("cycle_id", cycle.id),
    loadPeople(),
  ]);
  const evidenceStatus = new Map((evidence ?? []).map((e) => [e.branch_id, e.status]));
  const month = monthLabel(cycle.cycle_month);
  const plans: PlannedMail[] = [];

  for (const c of counts ?? []) {
    const parts = Number(c.parts);
    if (parts < 1) continue;
    const status = evidenceStatus.get(c.branch_id);
    if (status === "submitted" || status === "sent") continue; // already handed in: nothing to ask for
    const branchName = people.branchName.get(c.branch_id) ?? "Branch";
    const initialKey = `flagged-parts:${cycle.id}:${c.branch_id}`;
    const original = await findSentMail(initialKey);

    if (!original) {
      // Only while the deadline is still ahead: an old cycle never gets a first mail now.
      if (daysLeft < 1) continue;
      const { text, html } = mailContent.flaggedParts({ branch: branchName, month, parts, deadline: dateLabel(deadlineAt.toISOString()), origin });
      plans.push({
        kind: "flagged-parts",
        key: initialKey,
        branchId: c.branch_id,
        branchName,
        to: people.adminsByBranch.get(c.branch_id) ?? [],
        cc: people.officers,
        subject: `Action needed: ${parts} part${parts === 1 ? "" : "s"} flagged to scrap - ${branchName}`,
        text,
        html,
        label: "Parts flagged to scrap",
      });
      continue;
    }

    if (opts.only === "initial") continue;
    const milestone = reminderMilestone(daysLeft);
    if (!milestone) continue;
    const { text, html } = mailContent.flaggedReminder({ branch: branchName, month, parts, daysLeft, deadline: dateLabel(deadlineAt.toISOString()), origin });
    plans.push({
      kind: "flagged-parts-reminder",
      key: `flagged-parts-reminder:${cycle.id}:${c.branch_id}:${milestone}`,
      branchId: c.branch_id,
      branchName,
      to: people.adminsByBranch.get(c.branch_id) ?? [],
      cc: people.officers,
      subject: `Re: ${original.subject}`,
      text,
      html,
      replyToKey: initialKey,
      label: `Reminder - ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`,
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

// ---- 4. the podium congratulations ------------------------------------------------------------------------------

/**
 * Sent the working morning after the LAST branch result of a self-audit cycle is finalized (the daily job
 * runs at about 09:00, Sunday to Thursday). Goes to every branch admin, copying the warranty head, the
 * officers and the standing managers. Only a cycle finalized in the last 10 days is considered, so switching
 * the mail on never congratulates an old cycle.
 */
export async function planPodium(origin: string, now = new Date()): Promise<PlannedMail[]> {
  const { data: cycles } = await admin().from("self_audit_audit_cycles").select("id, cycle_month").order("cycle_month", { ascending: false }).limit(2);
  const plans: PlannedMail[] = [];
  const people = await loadPeople();

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
    if (calendarDaysBetween(last, now) < 1 || calendarDaysBetween(last, now) > 10) continue; // not before the next working morning; nothing old

    const top = results
      .filter((r) => people.branchName.has(r.branch_id))
      .map((r) => ({ name: people.branchName.get(r.branch_id)!, avg: Math.round(Number(r.score_pct) * 10) / 10 }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 3);
    if (top.length === 0) continue;

    const month = monthLabel(cycle.cycle_month);
    const { text, html } = mailContent.podium({ month, top, origin });
    plans.push({
      kind: "podium",
      key: `podium:${cycle.id}`,
      branchId: "all",
      branchName: "All branches",
      to: [...new Set([...people.adminsByBranch.values()].flat())],
      cc: [WARRANTY_HEAD_EMAIL, ...people.officers, ...PODIUM_STANDING_CC],
      subject: `${month} Self-Audit - Top Performing Branches`,
      text,
      html,
      label: `Podium - ${month}`,
    });
  }
  return plans;
}
