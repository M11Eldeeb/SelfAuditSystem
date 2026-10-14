"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMailStatus, sendMail } from "@/lib/gmail";
import { siteOrigin } from "@/lib/site-origin";
import { dateLabel, monthLabel } from "@/lib/mail/template";
import { internalAuditContent, planInternalAuditNotice, planInternalAuditResults } from "@/lib/mail/internal-audit";
import { MAIL_KEYS, isMailEnabled, mailContent, planFlaggedParts, planSelfAuditReady, sendPlans, type SendOutcome } from "@/lib/mail/plans";

const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

/** The cycle page's "Send mail" button: sends the "self audit is ready" mail to every branch that was assigned claims. */
export async function sendSelfAuditReadyMails(cycleId: string): Promise<{ error?: string; outcomes?: SendOutcome[] }> {
  const officer = await requireRole("officer");
  if (!(await getMailStatus())) return { error: "The e-mail sender is not connected yet - connect it in Settings → Email settings first." };
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
  if (!(await getMailStatus())) return { error: "The e-mail sender is not connected yet - connect it in Settings → Email settings first." };
  return sendOne(await planInternalAuditNotice(auditId), officer.id);
}

/** The report page's "Send results email" button, available once the audit is finalized. */
export async function sendInternalAuditResults(auditId: string): Promise<OneMailResult> {
  const officer = await requireRole("officer");
  if (!(await getMailStatus())) return { error: "The e-mail sender is not connected yet - connect it in Settings → Email settings first." };
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

/** Sends a clearly marked sample of one mail to the signed-in officer only, so the look and wording can be checked. */
export async function sendSampleMail(
  kind: "self-audit-ready" | "self-audit-reminder" | "flagged-parts" | "flagged-reminder" | "podium" | "internal-audit-notice" | "internal-audit-results"
): Promise<{ error?: string; sentTo?: string }> {
  const officer = await requireRole("officer");
  if (!(await getMailStatus())) return { error: "Connect the e-mail sender first." };
  const origin = await siteOrigin();
  const month = monthLabel(new Date().toISOString());
  const soon = new Date(Date.now() + 7 * 86_400_000).toISOString();

  const sample = {
    "self-audit-ready": { subject: `${month} self audit is ready`, ...mailContent.selfAuditReady({ month, claims: 10, deadline: dateLabel(soon), origin }) },
    "self-audit-reminder": {
      subject: `Re: ${month} self audit is ready`,
      ...mailContent.selfAuditReminder({ month, daysLeft: 3, deadline: dateLabel(soon), open: 6, total: 10, checklistOpen: true, origin }),
    },
    "flagged-parts": {
      subject: "Action needed: 14 parts flagged to scrap - Sample Branch",
      ...mailContent.flaggedParts({ branch: "Sample Branch", month, parts: 14, deadline: dateLabel(soon), origin }),
    },
    "flagged-reminder": {
      subject: "Re: Action needed: 14 parts flagged to scrap - Sample Branch",
      ...mailContent.flaggedReminder({ branch: "Sample Branch", month, parts: 14, daysLeft: 3, deadline: dateLabel(soon), origin }),
    },
    podium: {
      subject: `${month} Self-Audit - Top Performing Branches`,
      ...mailContent.podium({
        month,
        top: [
          { name: "Sample Branch A", avg: 97.5 },
          { name: "Sample Branch B", avg: 94 },
          { name: "Sample Branch C", avg: 91.2 },
        ],
        origin,
      }),
    },
    "internal-audit-notice": { subject: "Internal Audit Notice - Sample Branch", ...internalAuditContent.notice({ branch: "Sample Branch", claims: 15, auditDate: dateLabel(soon) }) },
    "internal-audit-results": { subject: "Internal Audit Results - Sample Branch", ...internalAuditContent.results({ branch: "Sample Branch", score: 86 }) },
  }[kind];

  const result = await sendMail({
    kind: "sample",
    to: [officer.email],
    sentBy: officer.id,
    subject: `[SAMPLE] ${sample.subject}`,
    text: `(This is a sample with made-up numbers - it was sent only to you${kind.startsWith("internal-audit") ? ", without the attachment" : ""}.)\n\n${sample.text}`,
    html: sample.html,
  });
  revalidatePath("/admin/emails");
  return result.ok ? { sentTo: officer.email } : { error: result.error };
}

export async function addServiceManager(branchId: string, email: string): Promise<{ error?: string }> {
  await requireRole("officer");
  const clean = email.trim().toLowerCase();
  if (!EMAIL.test(clean)) return { error: "Enter a valid e-mail address." };
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

