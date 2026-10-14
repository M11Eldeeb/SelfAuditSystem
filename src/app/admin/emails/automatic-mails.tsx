"use client";

import { useState, useTransition } from "react";
import type { MailDef, ResolvedTemplate } from "@/lib/mail/catalog";
import { sendSampleMail, setMailEnabled } from "./actions";
import { MailEditor } from "./mail-editor";

export type MailCard = {
  def: MailDef;
  /** When it goes out, in words (built from the saved reminder days and deadline). */
  when: string;
  /** Who is copied, in words. */
  copies: string;
  /** The on/off switch this mail follows (null: a button sends it). */
  switchKey: string | null;
  enabled: boolean;
  /** This mail shares the switch of another mail card (shown without its own switch). */
  sharedSwitch?: boolean;
  saved: ResolvedTemplate;
  customized: boolean;
};

/** Every mail: when and to whom, its on/off switch, a sample to yourself, and an editor for the wording, copies and days. */
export function MailCards({ cards, connected }: { cards: MailCard[]; connected: boolean }) {
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  function toggle(card: MailCard) {
    if (!card.switchKey) return;
    setMessage(null);
    setBusy(card.def.key);
    startTransition(async () => {
      const res = await setMailEnabled(card.switchKey!, !card.enabled);
      setBusy(null);
      if (res.error) setMessage({ tone: "bad", text: res.error });
    });
  }

  function sample(card: MailCard) {
    setMessage(null);
    setBusy(`sample-${card.def.key}`);
    startTransition(async () => {
      const res = await sendSampleMail(card.def.key);
      setBusy(null);
      setMessage(res.error ? { tone: "bad", text: res.error } : { tone: "good", text: `A sample of "${card.def.title}" was sent to ${res.sentTo}. Check your inbox (and spam).` });
    });
  }

  return (
    <div className="space-y-3">
      {cards.map((c) => {
        const isOpen = open === c.def.key;
        return (
          <div key={c.def.key} className="space-y-3 rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <h3 className="text-sm font-semibold text-neutral-900">
                  {c.def.title}
                  {c.customized && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200 ring-inset">Edited</span>}
                </h3>
                <p className="text-xs text-neutral-600">
                  <span className="font-medium text-neutral-700">When:</span> {c.when}
                </p>
                <p className="text-xs text-neutral-600">
                  <span className="font-medium text-neutral-700">To:</span> {c.def.to}
                </p>
                <p className="text-xs text-neutral-600">
                  <span className="font-medium text-neutral-700">Cc:</span> {c.copies}
                </p>
              </div>
              {c.switchKey && !c.sharedSwitch && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={c.enabled}
                  onClick={() => toggle(c)}
                  disabled={pending || !connected}
                  title={connected ? undefined : "Connect the e-mail sender first"}
                  className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${c.enabled ? "bg-emerald-500" : "bg-neutral-300"}`}
                >
                  <span className="sr-only">
                    {c.enabled ? "Switch off" : "Switch on"} {c.def.title}
                  </span>
                  <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${c.enabled ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${c.switchKey && c.enabled ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-neutral-100 text-neutral-700 ring-neutral-200"}`}>
                {!c.switchKey ? "Sent by a button" : c.sharedSwitch ? (c.enabled ? "Automatic - on" : "Off - nothing is sent") : c.enabled ? "Automatic - on" : "Off - nothing is sent"}
              </span>
              <button
                type="button"
                onClick={() => sample(c)}
                disabled={pending || !connected}
                className="rounded-lg border border-neutral-300 bg-white px-3 py-1 text-xs font-semibold text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 disabled:opacity-50"
              >
                {busy === `sample-${c.def.key}` ? "Sending..." : "Send me a sample"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : c.def.key)}
                aria-expanded={isOpen}
                className="rounded-lg border border-neutral-300 bg-white px-3 py-1 text-xs font-semibold text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50"
              >
                {isOpen ? "Close the editor" : "Edit this mail"}
              </button>
            </div>
            {isOpen && <MailEditor def={c.def} saved={c.saved} customized={c.customized} />}
          </div>
        );
      })}
      {message && (
        <p role="status" className={`rounded-lg border px-3 py-2 text-sm ${message.tone === "good" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
