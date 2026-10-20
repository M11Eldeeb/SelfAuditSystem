import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMailStatus } from "@/lib/gmail";
import { siteOrigin } from "@/lib/site-origin";
import { MAIL_DEFS, MAIL_KEYS_IN_ORDER, CC_GROUP_LABELS, type MailKey, type ResolvedTemplate } from "@/lib/mail/catalog";
import { loadPeople, loadTemplates } from "@/lib/mail/people";
import { planFlaggedParts, planPodium, planSelfAuditReminders } from "@/lib/mail/plans";
import { EmailSenderCard } from "./email-sender-card";
import { MailCards, type MailCard } from "./automatic-mails";
import { ContactLists } from "./contact-lists";
import { ServiceManagers, type BranchContactRole, type BranchManagers } from "./service-managers";

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" });

/** "7, 3 and 1 days" */
function daysPhrase(days: number[]): string {
  const sorted = [...days].sort((a, b) => b - a).map(String);
  const list = sorted.length > 1 ? `${sorted.slice(0, -1).join(", ")} and ${sorted[sorted.length - 1]}` : sorted[0];
  return `${list} day${sorted.length === 1 && sorted[0] === "1" ? "" : "s"}`;
}

const WHEN: Record<MailKey, (t: ResolvedTemplate) => string> = {
  ready: () => "When you press Send mail on Audits → Cycles right after generating the cycle - one mail for all the branches.",
  reminder: (t) => `Every working day (Sun-Thu) at about 8:30, on ${daysPhrase(t.milestones)} before the deadline - as a reply in the same thread as the "ready" mail. A branch that has finished gets nothing.`,
  flagged: (t) => `Once per admin, as soon as a scrap list generation finishes. The deadline is ${t.deadlineDays} days from the start of the warranty room cycle (evidence can still be uploaded later).`,
  flagged_reminder: (t) => `${daysPhrase(t.milestones)} before that deadline, in the same thread as the first mail (follows the switch of the first mail).`,
  podium: () => "At about 9:00 on the working morning after the last branch result of a self-audit cycle is finalized. The podium is drawn inside the mail.",
  notice: () => "Right after you create an internal audit for a branch. There is also a Send notice button on the Internal Audit list.",
  results: () => "When you press Send results email on a finalized audit's report page - so you choose the day.",
  inquiry_new: () => "Right when a workshop (or an officer) submits a technical inquiry. Goes to the technical advisor assigned to that branch (Technical Inquiries → Who handles which branch), or to the whole technical team.",
  inquiry_reply: () => "When the workshop replies on an open case - as a reply in the same thread as the first mail.",
  inquiry_resubmitted: () => "When the workshop sends a closed or cancelled case back to the technical team.",
  inquiry_cancelled: () => "When the workshop cancels a case that is still open.",
  inquiry_delegated: () => "When a technical advisor delegates a case to a colleague (or an officer assigns it). Goes to that technical advisor. Taking a case yourself, or opening an unassigned one, sends nothing.",
  inquiry_verify: () => "When a team leader submits a case (or sends one again). Goes to the workshop supervisor of the branch - the case reaches the technical team only after the supervisor verifies it.",
  inquiry_rejected: () => "When the workshop supervisor sends a team leader's case back with a reason. Goes to the team leader.",
  inquiry_answered: () => "When the technical team replies on a case. Goes to the branch's admins, with the service manager, workshop supervisor and workshop team leader copied.",
  inquiry_closed: () => "When the technical team closes a case with the solution.",
  inquiry_reopened: () => "When the technical team reopens a closed case.",
  scrap_evidence_submitted: () => "Right when a branch submits its scrap (destroy) evidence videos in the Warranty Room. Goes to the warranty officers.",
  scrap_evidence_approved: () => "Right when an officer approves a branch's scrap evidence. Goes to the branch's admins (follows the switch of the submitted mail).",
};

export default async function EmailsPage({ searchParams }: { searchParams: Promise<{ mail?: string; detail?: string }> }) {
  await requireRole("officer");
  const { mail, detail } = await searchParams;
  const admin = createAdminClient();
  const [connection, origin] = await Promise.all([getMailStatus(), siteOrigin()]);

  const [{ data: settings }, { data: branches }, { data: contacts }, { data: log }, { data: savedRows }, reminderPlans, flaggedPlans, podiumPlans, templates, people] = await Promise.all([
    admin.from("self_audit_mail_settings").select("key, enabled"),
    admin.from("self_audit_branches").select("id, name").eq("active", true).order("name"),
    admin.from("self_audit_branch_contacts").select("id, branch_id, email, role").order("email"),
    admin.from("self_audit_email_log").select("id, kind, recipients, subject, status, error, sent_at").order("sent_at", { ascending: false }).limit(25),
    admin.from("self_audit_mail_templates").select("key"),
    planSelfAuditReminders(origin),
    planFlaggedParts(origin),
    planPodium(origin),
    loadTemplates(),
    loadPeople(),
  ]);
  const enabled = new Map((settings ?? []).map((s) => [s.key, s.enabled]));
  const customized = new Set((savedRows ?? []).map((r) => r.key));

  const plans = [...reminderPlans, ...flaggedPlans, ...podiumPlans];
  const { data: sentRows } = plans.length
    ? await admin.from("self_audit_email_log").select("dedupe_key").eq("status", "sent").in("dedupe_key", plans.map((p) => p.key))
    : { data: [] as { dedupe_key: string | null }[] };
  const alreadySent = new Set((sentRows ?? []).map((r) => r.dedupe_key));
  const waiting = plans.filter((p) => !alreadySent.has(p.key));

  const cards: MailCard[] = MAIL_KEYS_IN_ORDER.map((key) => {
    const def = MAIL_DEFS[key];
    const t = templates[key];
    const copyParts = [...t.ccGroups.map((g) => CC_GROUP_LABELS[g]), ...t.extraCc];
    return {
      def,
      when: WHEN[key](t),
      copies: copyParts.length ? copyParts.join("; ") : "nobody",
      switchKey: def.switchKey,
      enabled: def.switchKey ? enabled.get(def.switchKey) === true : false,
      // A mail that follows the same switch as the card before it is shown without a switch of its own.
      sharedSwitch: def.switchKey !== null && MAIL_DEFS[MAIL_KEYS_IN_ORDER[MAIL_KEYS_IN_ORDER.indexOf(key) - 1]]?.switchKey === def.switchKey,
      saved: t,
      customized: customized.has(key),
    };
  });

  const contactsByBranch = new Map<string, { id: string; email: string; role: BranchContactRole }[]>();
  for (const c of contacts ?? []) contactsByBranch.set(c.branch_id, [...(contactsByBranch.get(c.branch_id) ?? []), { id: c.id, email: c.email, role: c.role }]);
  const branchRows: BranchManagers[] = (branches ?? []).map((b) => ({ branchId: b.id, branchName: b.name, contacts: contactsByBranch.get(b.id) ?? [] }));

  return (
    <div className="space-y-8">
      <section className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Email settings</h1>
        <p className="text-sm text-neutral-600">
          The portal sends these mails itself, from the connected mailbox. Every mail below can be edited - the wording, who is copied, extra addresses and the reminder days. Each automatic mail is switched off until you turn it on, and a mail is never sent twice.
        </p>
      </section>

      <EmailSenderCard connection={connection} flag={mail} detail={detail} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">Mails</h2>
        <MailCards cards={cards} connected={!!connection} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">What the next run would send</h2>
        <p className="text-sm text-neutral-600">A live look at what the daily 8:30 job would send right now if the mails were switched on. Nothing here has been sent.</p>
        {waiting.length === 0 ? (
          <p className="rounded-xl border border-neutral-200/70 bg-white p-4 text-sm text-neutral-500 shadow-sm">Nothing is due right now.</p>
        ) : (
          <ul className="space-y-2">
            {waiting.map((p) => (
              <li key={p.key} className="rounded-xl border border-neutral-200/70 bg-white p-4 text-sm shadow-sm">
                <details>
                  <summary className="cursor-pointer font-medium text-neutral-900">
                    {p.branchName} - {p.label}
                    {p.to.length === 0 && <span className="ml-2 text-xs font-normal text-red-600">no branch admin account</span>}
                  </summary>
                  <dl className="mt-3 space-y-1 text-xs text-neutral-700">
                    <div><dt className="inline font-semibold">To: </dt><dd className="inline">{p.to.join(", ") || "-"}</dd></div>
                    {p.cc.length > 0 && <div><dt className="inline font-semibold">Cc: </dt><dd className="inline">{[...new Set(p.cc)].join(", ")}</dd></div>}
                    <div><dt className="inline font-semibold">Subject: </dt><dd className="inline">{p.subject}</dd></div>
                  </dl>
                  <pre className="mt-3 rounded-lg bg-neutral-50 p-3 font-sans text-xs whitespace-pre-wrap text-neutral-800">{p.text}</pre>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">Standing contacts</h2>
        <p className="text-sm text-neutral-600">The people the &quot;copy&quot; options refer to. Change an address here and every mail that copies them follows.</p>
        <ContactLists head={people.head} aftersales={people.aftersales} standing={people.standing} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">Branch contacts</h2>
        <p className="text-sm text-neutral-600">Copied on the mails of their branch: the service managers on the self-audit and internal audit mails, and the service manager, workshop supervisor and workshop team leader on the technical inquiry mails to the workshop.</p>
        <ServiceManagers branches={branchRows} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">Recent e-mails</h2>
        <div className="overflow-hidden rounded-xl border border-neutral-200/70 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs font-semibold tracking-wide text-neutral-500 uppercase">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Mail</th>
                <th className="px-4 py-2">To</th>
                <th className="px-4 py-2">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {(log ?? []).map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2 whitespace-nowrap text-neutral-600">{stamp(l.sent_at)}</td>
                  <td className="px-4 py-2 text-neutral-900">
                    {l.subject}
                    <span className="block text-xs text-neutral-500">{l.kind}</span>
                  </td>
                  <td className="px-4 py-2 text-xs text-neutral-600">
                    {l.recipients.slice(0, 2).join(", ")}
                    {l.recipients.length > 2 ? ` +${l.recipients.length - 2}` : ""}
                  </td>
                  <td className="px-4 py-2">
                    <span className={l.status === "sent" ? "text-emerald-700" : "text-red-600"}>{l.status === "sent" ? "Sent" : "Failed"}</span>
                    {l.error && <span className="block max-w-[260px] text-xs break-words text-red-600">{l.error}</span>}
                  </td>
                </tr>
              ))}
              {(log ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-neutral-400">
                    Nothing has been sent yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
