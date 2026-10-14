"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendSelfAuditReadyMails } from "@/app/admin/emails/actions";

/** The open cycle's "self audit is ready" mail: how many branches got it, and the Send mail button for the rest. */
export function SendReadyMailCard({
  cycleId,
  cycleLabel,
  branchesTotal,
  branchesSent,
}: {
  cycleId: string;
  cycleLabel: string;
  branchesTotal: number;
  branchesSent: number;
}) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<{ good: boolean; text: string } | null>(null);
  const allSent = branchesTotal > 0 && branchesSent >= branchesTotal;

  async function send() {
    setNote(null);
    setSending(true);
    const res = await sendSelfAuditReadyMails(cycleId);
    setSending(false);
    if (res.error) return setNote({ good: false, text: res.error });
    const outcomes = res.outcomes ?? [];
    const ok = outcomes.filter((o) => o.status === "sent" || o.status === "already-sent").length;
    const problems = outcomes.filter((o) => o.status === "failed" || o.status === "no-recipients");
    setNote({
      good: problems.length === 0,
      text:
        `Sent to ${ok} of ${outcomes.length} branch${outcomes.length === 1 ? "" : "es"}.` +
        (problems.length ? ` Not sent: ${problems.map((o) => `${o.branchName} (${o.error ?? o.status})`).join("; ")}.` : ""),
    });
    router.refresh();
  }

  return (
    <div className="space-y-2 rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-neutral-900">{cycleLabel} self audit - &quot;ready&quot; mail</p>
          <p className="text-xs text-neutral-500">
            {allSent
              ? `Sent to all ${branchesTotal} branches.`
              : `Sent to ${branchesSent} of ${branchesTotal} branches. Each branch's admins get their own mail, with the warranty team and service managers in copy.`}{" "}
            Reminders go out by themselves (7, 3 and 1 day before the deadline) once switched on in{" "}
            <Link href="/admin/emails" className="text-brand hover:underline">
              Email settings
            </Link>
            .
          </p>
        </div>
        {!allSent && (
          <button
            type="button"
            onClick={send}
            disabled={sending}
            className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white shadow-sm shadow-brand/25 transition hover:bg-brand-dark hover:shadow-md hover:shadow-brand/30 disabled:opacity-50"
          >
            {sending ? "Sending..." : "Send mail"}
          </button>
        )}
      </div>
      {note && (
        <p role="status" className={`rounded-lg border px-3 py-2 text-sm ${note.good ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
          {note.text}
        </p>
      )}
    </div>
  );
}
