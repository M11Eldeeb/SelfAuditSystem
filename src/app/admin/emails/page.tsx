import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMailStatus } from "@/lib/gmail";
import { siteOrigin } from "@/lib/site-origin";
import { FLAGGED_DEADLINE_DAYS, MAIL_KEYS, WARRANTY_HEAD_EMAIL, planFlaggedParts, planSelfAuditReminders } from "@/lib/mail/plans";
import { EmailSenderCard } from "./email-sender-card";
import { AutomaticMails, type AutomaticMail } from "./automatic-mails";
import { ServiceManagers, type BranchManagers } from "./service-managers";

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" });

export default async function EmailsPage({ searchParams }: { searchParams: Promise<{ mail?: string; detail?: string }> }) {
  await requireRole("officer");
  const { mail, detail } = await searchParams;
  const admin = createAdminClient();
  const [connection, origin] = await Promise.all([getMailStatus(), siteOrigin()]);

  const [{ data: settings }, { data: branches }, { data: contacts }, { data: log }, reminderPlans, flaggedPlans] = await Promise.all([
    admin.from("self_audit_mail_settings").select("key, enabled"),
    admin.from("self_audit_branches").select("id, name").eq("active", true).order("name"),
    admin.from("self_audit_branch_contacts").select("id, branch_id, email").order("email"),
    admin.from("self_audit_email_log").select("id, kind, recipients, subject, status, error, sent_at").order("sent_at", { ascending: false }).limit(25),
    planSelfAuditReminders(origin),
    planFlaggedParts(origin),
  ]);
  const enabled = new Map((settings ?? []).map((s) => [s.key, s.enabled]));

  const plans = [...reminderPlans, ...flaggedPlans];
  const { data: sentRows } = plans.length
    ? await admin.from("self_audit_email_log").select("dedupe_key").eq("status", "sent").in("dedupe_key", plans.map((p) => p.key))
    : { data: [] as { dedupe_key: string | null }[] };
  const alreadySent = new Set((sentRows ?? []).map((r) => r.dedupe_key));
  const waiting = plans.filter((p) => !alreadySent.has(p.key));

  const mails: AutomaticMail[] = [
    {
      key: "manual-ready",
      manual: true,
      title: "Self audit is ready",
      when: "When you press Send mail on Audits → Cycles right after generating the cycle.",
      recipients: `Each branch's admins (To), one mail per branch. Copy: Mustafa Nasr (${WARRANTY_HEAD_EMAIL}), all officers, and the branch's service managers.`,
      enabled: true,
      samples: [{ kind: "self-audit-ready", label: "ready" }],
    },
    {
      key: MAIL_KEYS.selfAuditReminder,
      title: "Self-audit reminders",
      when: "Every working day (Sun-Thu) at about 8:30, on 7, 3 and 1 day before the deadline - as a reply in the same thread as the \"ready\" mail. A branch that has finished gets nothing.",
      recipients: "Admins of branches with unsubmitted claims or an unsubmitted checklist (To). Same copies as the \"ready\" mail.",
      enabled: enabled.get(MAIL_KEYS.selfAuditReminder) === true,
      samples: [{ kind: "self-audit-reminder", label: "reminder" }],
    },
    {
      key: MAIL_KEYS.flaggedParts,
      title: "Flagged parts (scrap evidence)",
      when: `Once, as soon as a scrap list generation finishes. Deadline: ${FLAGGED_DEADLINE_DAYS} days from the start of the warranty room cycle (evidence can still be uploaded later). Then reminders on 7, 3 and 1 day before the deadline, in the same thread.`,
      recipients: "Admins of only the branches that have parts flagged and have not submitted yet. No copies.",
      enabled: enabled.get(MAIL_KEYS.flaggedParts) === true,
      samples: [
        { kind: "flagged-parts", label: "first mail" },
        { kind: "flagged-reminder", label: "reminder" },
      ],
    },
  ];

  const managersByBranch = new Map<string, { id: string; email: string }[]>();
  for (const c of contacts ?? []) managersByBranch.set(c.branch_id, [...(managersByBranch.get(c.branch_id) ?? []), { id: c.id, email: c.email }]);
  const branchRows: BranchManagers[] = (branches ?? []).map((b) => ({ branchId: b.id, branchName: b.name, managers: managersByBranch.get(b.id) ?? [] }));

  return (
    <div className="space-y-8">
      <section className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Emails</h1>
        <p className="text-sm text-neutral-600">
          The portal sends these mails itself, from the connected mailbox. Each automatic mail is switched off until you turn it on, and a mail is never sent twice.
        </p>
      </section>

      <EmailSenderCard connection={connection} flag={mail} detail={detail} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">Mails</h2>
        <AutomaticMails mails={mails} connected={!!connection} />
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
        <h2 className="text-lg font-semibold text-neutral-900">Service managers</h2>
        <p className="text-sm text-neutral-600">Copied on the self-audit mails for their branch. Add each branch&apos;s service manager(s).</p>
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
