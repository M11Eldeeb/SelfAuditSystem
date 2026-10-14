"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMailStatus, sendMail } from "@/lib/gmail";
import { siteOrigin } from "@/lib/site-origin";
import { MAIL_DEFS, MAIL_KEYS_IN_ORDER, SAMPLE_PODIUM, composeMail, sampleVars, validateTemplate, type CcGroup, type MailKey } from "@/lib/mail/catalog";
import { loadTemplates, VALID_EMAIL } from "@/lib/mail/people";
import { planInternalAuditNotice, planInternalAuditResults } from "@/lib/mail/internal-audit";
import { MAIL_KEYS, isMailEnabled, planFlaggedParts, planSelfAuditReady, sendPlans, type SendOutcome } from "@/lib/mail/plans";

const NOT_CONNECTED = "The e-mail sender is not connected yet - connect it in Settings → Email settings first.";

/** The cycle page's "Send mail" button: sends the "self audit is ready" mail to every branch that was assigned claims. */
export async function sendSelfAuditReadyMails(cycleId: string): Promise<{ error?: string; outcomes?: SendOutcome[] }> {
  const officer = await requireRole("officer");
  if (!(await getMailStatus())) return { error: NOT_CONNECTED };
  const plans = await planSelfAuditReady(cycleId, await siteOrigin());
  if (plans.length === 0) return { error: "No branch was assigned claims in this cycle - nothing to send." };
  const outcomes = await sendPlans(plans, officer.id);
  revalidatePath("/admin/emails");
  return { outcomes };
}

type OneMailResult = { error?: string; alreadySent?: boolean; to?: string[] };

async function sendOne(plan: Awaited<ReturnType<typeof planInternalAuditNotice>>, officerId: string): Promise<OneMailResult> {
  if (!plan) return { error: "This audit has no branch (or no claims) to send to." };
  if (plan.to.length === 0) return { error: `${plan.branchName} has no branch admin account with a valid e-mail address.` };
  const [outcome] = await sendPlans([plan], officerId);
  revalidatePath("/admin/emails");
  revalidatePath("/admin/internal-audit");
  if (outcome.status === "failed") return { error: outcome.error };
  return { alreadySent: outcome.status === "already-sent", to: plan.to };
}

/** The internal-audit list's "Send notice" button (the notice also goes out by itself when the audit is created, if that mail is switched on). */
export async function sendInternalAuditNotice(auditId: string): Promise<OneMailResult> {
  const officer = await requireRole("officer");
  if (!(await getMailStatus())) return { error: NOT_CONNECTED };
  return sendOne(await planInternalAuditNotice(auditId), officer.id);
}

/** The report page's "Send results email" button, available once the audit is finalized. */
export async function sendInternalAuditResults(auditId: string): Promise<OneMailResult> {
  const officer = await requireRole("officer");
  if (!(await getMailStatus())) return { error: NOT_CONNECTED };
  return sendOne(await planInternalAuditResults(auditId), officer.id);
}

/**
 * Called by the Warranty Room page the moment a scrap list generation finishes: sends the first
 * "parts flagged to scrap" mail to the branches that have parts flagged - if that automatic mail is switched on.
 * The daily job does the same (and the reminders), and a mail is never sent twice, so both can run safely.
 */
export async function sendFlaggedPartsMailsNow(): Promise<{ sent: number }> {
  const officer = await requireRole("officer");
  if (!(await getMailStatus()) || !(await isMailEnabled(MAIL_KEYS.flaggedParts))) return { sent: 0 };
  const outcomes = await sendPlans(await planFlaggedParts(await siteOrigin(), { only: "initial" }), officer.id);
  revalidatePath("/admin/emails");
  return { sent: outcomes.filter((o) => o.status === "sent").length };
}

export async function setMailEnabled(key: string, enabled: boolean): Promise<{ error?: string }> {
  const officer = await requireRole("officer");
  if (!Object.values(MAIL_KEYS).includes(key as (typeof MAIL_KEYS)[keyof typeof MAIL_KEYS])) return { error: "Unknown e-mail." };
  if (enabled && !(await getMailStatus())) return { error: "Connect the e-mail sender first." };
  const { error } = await createAdminClient()
    .from("self_audit_mail_settings")
    .upsert({ key, enabled, updated_by: officer.id, updated_at: new Date().toISOString() });
  if (error) return { error: error.message };
  revalidatePath("/admin/emails");
  return {};
}

/** Sends a clearly marked sample of one mail (with made-up numbers, in its saved wording) to the signed-in officer only. */
export async function sendSampleMail(key: MailKey): Promise<{ error?: string; sentTo?: string }> {
  const officer = await requireRole("officer");
  if (!(await getMailStatus())) return { error: "Connect the e-mail sender first." };
  const def = MAIL_DEFS[key];
  if (!def) return { error: "Unknown e-mail." };
  const t = (await loadTemplates())[key];
  const mail = composeMail(t, sampleVars(def), key === "podium" ? SAMPLE_PODIUM : undefined);

  const result = await sendMail({
    kind: "sample",
    to: [officer.email],
    sentBy: officer.id,
    subject: `[SAMPLE] ${def.asReply ? `Re: ${mail.subject}` : mail.subject}`,
    text: `(This is a sample with made-up numbers - it was sent only to you${def.attachment ? ", without the attachment" : ""}.)\n\n${mail.text}`,
    html: mail.html,
  });
  revalidatePath("/admin/emails");
  return result.ok ? { sentTo: officer.email } : { error: result.error };
}

// ---- editing the mails ------------------------------------------------------------------------------------------------

export type SaveTemplateInput = {
  key: MailKey;
  subject: string;
  body: string;
  ccGroups: CcGroup[];
  extraTo: string[];
  extraCc: string[];
  milestones?: number[];
  deadlineDays?: number;
};

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const cleanList = (list: string[]) => list.map((e) => e.trim().toLowerCase()).filter(Boolean);

/** Saves what the officer changed for one mail. Anything left the same as the built-in wording is stored as "no change". */
export async function saveMailTemplate(input: SaveTemplateInput): Promise<{ error?: string }> {
  const officer = await requireRole("officer");
  const def = MAIL_DEFS[input.key];
  if (!def) return { error: "Unknown e-mail." };

  const problem = validateTemplate(def, input.subject, input.body);
  if (problem) return { error: problem };
  const extraTo = cleanList(input.extraTo);
  const extraCc = cleanList(input.extraCc);
  const badAddress = [...extraTo, ...extraCc].find((e) => !VALID_EMAIL.test(e));
  if (badAddress) return { error: `"${badAddress}" is not a valid e-mail address.` };
  const groups = [...new Set(input.ccGroups)].filter((g): g is CcGroup => g in { head: 1, officers: 1, service_managers: 1, standing: 1 });

  const settings: { milestones?: number[]; deadline_days?: number } = {};
  if (def.milestones && input.milestones) {
    const m = [...new Set(input.milestones.map(Math.round))].filter((n) => n >= 1 && n <= 60).sort((a, b) => b - a);
    if (m.length === 0 || m.length > 6) return { error: "Give between 1 and 6 reminder days (each between 1 and 60)." };
    if (!sameSet(m.map(String), def.milestones.map(String))) settings.milestones = m;
  }
  if (def.deadlineDays && input.deadlineDays != null) {
    const d = Math.round(input.deadlineDays);
    if (!(d >= 1 && d <= 90)) return { error: "The deadline must be between 1 and 90 days." };
    if (d !== def.deadlineDays) settings.deadline_days = d;
  }

  const { error } = await createAdminClient()
    .from("self_audit_mail_templates")
    .upsert({
      key: input.key,
      subject: input.subject === def.defaultSubject ? null : input.subject,
      body: input.body.replace(/\r\n/g, "\n") === def.defaultBody ? null : input.body.replace(/\r\n/g, "\n"),
      cc_groups: sameSet(groups, def.defaultCc) ? null : groups,
      extra_to: extraTo,
      extra_cc: extraCc,
      settings,
      updated_by: officer.id,
      updated_at: new Date().toISOString(),
    });
  if (error) return { error: error.message };
  revalidatePath("/admin/emails");
  return {};
}

/** Puts a mail back to the built-in wording, copies and days. */
export async function resetMailTemplate(key: MailKey): Promise<{ error?: string }> {
  await requireRole("officer");
  if (!MAIL_KEYS_IN_ORDER.includes(key)) return { error: "Unknown e-mail." };
  const { error } = await createAdminClient().from("self_audit_mail_templates").delete().eq("key", key);
  if (error) return { error: error.message };
  revalidatePath("/admin/emails");
  return {};
}

/** The standing lists: the warranty head, and the managers copied on the podium mail. */
export async function saveMailList(key: "warranty_head" | "standing_managers", emails: string[]): Promise<{ error?: string }> {
  const officer = await requireRole("officer");
  if (key !== "warranty_head" && key !== "standing_managers") return { error: "Unknown list." };
  const clean = [...new Set(cleanList(emails))];
  const bad = clean.find((e) => !VALID_EMAIL.test(e));
  if (bad) return { error: `"${bad}" is not a valid e-mail address.` };
  const { error } = await createAdminClient().from("self_audit_mail_lists").upsert({ key, emails: clean, updated_by: officer.id, updated_at: new Date().toISOString() });
  if (error) return { error: error.message };
  revalidatePath("/admin/emails");
  return {};
}

export async function addServiceManager(branchId: string, email: string): Promise<{ error?: string }> {
  await requireRole("officer");
  const clean = email.trim().toLowerCase();
  if (!VALID_EMAIL.test(clean)) return { error: "Enter a valid e-mail address." };
  const { error } = await createAdminClient().from("self_audit_branch_contacts").insert({ branch_id: branchId, email: clean, role: "service_manager" });
  if (error) return { error: error.code === "23505" ? "That address is already listed for this branch." : error.message };
  revalidatePath("/admin/emails");
  return {};
}

export async function removeServiceManager(id: string): Promise<{ error?: string }> {
  await requireRole("officer");
  const { error } = await createAdminClient().from("self_audit_branch_contacts").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/emails");
  return {};
}
