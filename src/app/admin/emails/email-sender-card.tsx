"use client";

import { useState, useTransition } from "react";
import { sendTestEmail } from "./sender-actions";

const MESSAGES: Record<string, { tone: "good" | "bad"; text: string }> = {
  connected: { tone: "good", text: "The e-mail sender is connected." },
  cancelled: { tone: "bad", text: "The Google sign-in was cancelled, so nothing was connected." },
  "not-configured": { tone: "bad", text: "Google sign-in is not set up on the server yet (the Google client ID and secret are missing)." },
  "bad-state": { tone: "bad", text: "That sign-in could not be verified. Please try connecting again." },
  "no-refresh-token": { tone: "bad", text: "Google did not give a lasting connection. Remove the app's access in that Google account's settings, then connect again." },
  "wrong-account": { tone: "bad", text: "That is not a company (@jiadmotors.com) mailbox. Sign in with the mailbox the e-mails should come from." },
  "no-send-permission": { tone: "bad", text: "The permission to send e-mail was not ticked on Google's screen. Connect again and keep every box ticked." },
  failed: { tone: "bad", text: "Connecting the e-mail sender failed. Please try again; if it keeps failing, check the Google settings." },
};

/** Officer-only: which mailbox the portal sends e-mail from, connect / reconnect, and a test message to yourself. */
export function EmailSenderCard({ connection, flag, detail }: { connection: { accountEmail: string } | null; flag?: string; detail?: string }) {
  const note = flag ? MESSAGES[flag] : undefined;
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ tone: "good" | "bad"; text: string } | null>(null);

  function test() {
    setResult(null);
    startTransition(async () => {
      const res = await sendTestEmail();
      setResult(res.error ? { tone: "bad", text: res.error } : { tone: "good", text: `Test sent to ${res.sentTo} from ${res.from}. Check your inbox (and spam).` });
    });
  }

  const tone = (t: "good" | "bad") => (t === "good" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700");

  return (
    <section className="space-y-3 rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900">E-mail sender</h2>
        <p className="text-xs text-neutral-500">
          The mailbox the portal sends e-mail from (reminders and notices). It can only send - it cannot read anything in the mailbox.
        </p>
      </div>
      {note && (
        <p role="status" className={`rounded-lg border px-3 py-2 text-sm ${tone(note.tone)}`}>
          {note.text}
          {detail && <span className="mt-1 block font-mono text-xs break-words opacity-90">{detail}</span>}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-700">
          {connection ? (
            <>
              <span className="mr-2 inline-block h-2 w-2 rounded-full bg-emerald-500 align-middle" aria-hidden="true" />
              Sending as <span className="font-medium text-neutral-900">{connection.accountEmail}</span>
            </>
          ) : (
            <span className="text-amber-800">Not connected yet - e-mails still open in your own mail app.</span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {connection && (
            <button
              type="button"
              onClick={test}
              disabled={pending}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 disabled:opacity-60"
            >
              {pending ? "Sending..." : "Send a test to me"}
            </button>
          )}
          <a
            href="/api/google-mail/connect"
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-brand-dark"
          >
            {connection ? "Reconnect" : "Connect the e-mail sender"}
          </a>
        </div>
      </div>
      {result && (
        <p role="status" className={`rounded-lg border px-3 py-2 text-sm ${tone(result.tone)}`}>
          {result.text}
        </p>
      )}
    </section>
  );
}
