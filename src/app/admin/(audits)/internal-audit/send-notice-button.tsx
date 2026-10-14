"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendInternalAuditNotice } from "@/app/admin/emails/actions";

/** E-mails the audit notice (with the Excel sheet of the claims) to the branch's admins, or shows that it already went. */
export function SendNoticeButton({ auditId, sent }: { auditId: string; sent: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sent) return <span className="text-xs text-emerald-700">Notice sent</span>;
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setError(null);
          setBusy(true);
          const res = await sendInternalAuditNotice(auditId);
          setBusy(false);
          if (res.error) setError(res.error);
          else router.refresh();
        }}
        className="text-sm text-brand hover:underline disabled:opacity-50"
      >
        {busy ? "Sending..." : "Send notice"}
      </button>
      {error && <span className="max-w-[220px] text-right text-xs text-red-600">{error}</span>}
    </span>
  );
}
