"use client";

import { useState, useTransition } from "react";
import { sendSampleMail, setMailEnabled } from "./actions";

export type AutomaticMail = {
  key: string; // self_audit_reminder | flagged_parts (or "manual-ready")
  /** Sent by a button elsewhere, so it has no on/off switch. */
  manual?: boolean;
  title: string;
  when: string;
  recipients: string;
  enabled: boolean;
  samples: { kind: "self-audit-ready" | "self-audit-reminder" | "flagged-parts" | "flagged-reminder"; label: string }[];
};

/** The automatic mails, each with its on/off switch and a "send me a sample" button. All start switched off. */
export function AutomaticMails({ mails, connected }: { mails: AutomaticMail[]; connected: boolean }) {
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  function toggle(mail: AutomaticMail) {
    setMessage(null);
    setBusy(mail.key);
    startTransition(async () => {
      const res = await setMailEnabled(mail.key, !mail.enabled);
      setBusy(null);
      if (res.error) setMessage({ tone: "bad", text: res.error });
    });
  }

  function sample(kind: AutomaticMail["samples"][number]["kind"]) {
    setMessage(null);
    setBusy(kind);
    startTransition(async () => {
      const res = await sendSampleMail(kind);
      setBusy(null);
      setMessage(res.error ? { tone: "bad", text: res.error } : { tone: "good", text: `A sample was sent to ${res.sentTo}. Check your inbox (and spam).` });
    });
  }

  return (
    <div className="space-y-3">
      {mails.map((m) => (
        <div key={m.key} className="space-y-3 rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h3 className="text-sm font-semibold text-neutral-900">{m.title}</h3>
              <p className="text-xs text-neutral-600">
                <span className="font-medium text-neutral-700">When:</span> {m.when}
              </p>
              <p className="text-xs text-neutral-600">
                <span className="font-medium text-neutral-700">Goes to:</span> {m.recipients}
              </p>
            </div>
            {!m.manual && (
            <button
              type="button"
              role="switch"
              aria-checked={m.enabled}
              onClick={() => toggle(m)}
              disabled={pending || !connected}
              title={connected ? undefined : "Connect the e-mail sender first"}
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${m.enabled ? "bg-emerald-500" : "bg-neutral-300"}`}
            >
              <span className="sr-only">{m.enabled ? "Switch off" : "Switch on"} {m.title}</span>
              <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${m.enabled ? "translate-x-6" : "translate-x-1"}`} />
            </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${m.enabled ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-neutral-100 text-neutral-700 ring-neutral-200"}`}>
              {m.manual ? "Sent by the Send mail button" : m.enabled ? "Automatic - on" : "Off - nothing is sent"}
            </span>
            {m.samples.map((s) => (
              <button
                key={s.kind}
                type="button"
                onClick={() => sample(s.kind)}
                disabled={pending || !connected}
                className="rounded-lg border border-neutral-300 bg-white px-3 py-1 text-xs font-semibold text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 disabled:opacity-50"
              >
                {busy === s.kind ? "Sending..." : `Send me a sample: ${s.label}`}
              </button>
            ))}
          </div>
        </div>
      ))}
      {message && (
        <p role="status" className={`rounded-lg border px-3 py-2 text-sm ${message.tone === "good" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
