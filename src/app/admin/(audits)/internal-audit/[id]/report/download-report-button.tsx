"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { generateInternalAuditPdf, type InternalAuditPdfData } from "@/lib/internal-audit-pdf";
import { sendInternalAuditResults } from "@/app/admin/emails/actions";

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" });

export function ReportActions({
  data,
  auditId,
  showEmailButton = true,
  resultsSentAt,
}: {
  data: InternalAuditPdfData;
  auditId: string;
  showEmailButton?: boolean;
  /** When the results e-mail already went out, if it did. */
  resultsSentAt: string | null;
}) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<{ good: boolean; text: string } | null>(null);

  async function send() {
    setNote(null);
    setSending(true);
    const res = await sendInternalAuditResults(auditId);
    setSending(false);
    if (res.error) return setNote({ good: false, text: res.error });
    setNote({ good: true, text: res.alreadySent ? "The results e-mail was already sent." : `Results e-mailed to ${res.to?.join(", ")}.` });
    router.refresh();
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => generateInternalAuditPdf(data)}
          className="rounded-lg bg-brand shadow-sm shadow-brand/25 hover:shadow-md hover:shadow-brand/30 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark"
        >
          Download PDF
        </button>
        {showEmailButton && (
          <button
            type="button"
            disabled={sending || !!resultsSentAt}
            onClick={send}
            className="rounded-lg border border-neutral-300 bg-white shadow-sm transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none px-4 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? "Sending..." : "Send results email"}
          </button>
        )}
      </div>
      {showEmailButton && (
        <p className="max-w-xs text-right text-xs text-neutral-500">
          {resultsSentAt
            ? `Results e-mailed on ${stamp(resultsSentAt)}.`
            : "E-mails the results PDF to the branch's admins (copy: Mustafa Nasr, the service manager and the officers)."}
        </p>
      )}
      {note && <p className={`max-w-xs text-right text-xs ${note.good ? "text-emerald-700" : "text-red-600"}`}>{note.text}</p>}
    </div>
  );
}
