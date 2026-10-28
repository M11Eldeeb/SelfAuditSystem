"use client";

import { useState } from "react";
import { sendDirectMail } from "@/app/actions/direct-mail";
import type { PaymentRow } from "@/app/admin/dashboard/payment-actions";
import { fmtNum } from "@/components/dashboard/ui";
import { Glyph } from "@/components/ui/glyph";

const TO_KEY = "payments-follow-up-to";
const CC_KEY = "payments-follow-up-cc";
const fmtDay = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const read = (k: string) => {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    // private window - fine
  }
};
const split = (v: string) => v.split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean);

/** The monthly follow-up to the manufacturer: every pending payment order, its amount, creation date and due date. */
function draft(pending: PaymentRow[], today: string, from: string) {
  const cur = pending[0]?.currency ?? "USD";
  const total = pending.reduce((s, r) => s + r.totalVat, 0);
  const month = new Date(`${today}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const lines = pending.map((r) => {
    const late = r.dueDate && today > r.dueDate;
    return `- ${r.paymentOrder} - created ${fmtDay(r.creationDate)} - ${cur} ${fmtNum(r.totalVat, 2)}${r.claims ? ` (${r.claims.toLocaleString("en-US")} claims)` : ""} - ${late ? `OVERDUE since ${fmtDay(r.dueDate)}` : `due by ${fmtDay(r.dueDate)}`}`;
  });
  const overdue = pending.filter((r) => r.dueDate && today > r.dueDate);
  return {
    subject: `Pending warranty payments - Jiad Modern Motors - ${month}`,
    body: [
      "Dear Warranty Team,",
      "",
      `Kindly note that the following warranty payment order${pending.length === 1 ? " is" : "s are"} still pending remittance to Jiad Modern Motors Co. (JMM):`,
      "",
      ...lines,
      "",
      `Total pending: ${cur} ${fmtNum(total, 2)}`,
      ...(overdue.length ? ["", `${overdue.length === 1 ? "One payment order has" : `${overdue.length} payment orders have`} passed the 3-month remittance period - we would appreciate your priority on ${overdue.length === 1 ? "it" : "them"}.`] : []),
      "",
      "Could you please advise the expected remittance date for each payment order, and share the remittance advice once the transfer is made?",
      "",
      "Thank you,",
      from,
      "Warranty Department - Jiad Modern Motors",
    ].join("\n"),
  };
}

/** "Draft follow-up email": an editable email about the pending payments - send it from the warranty mailbox, or copy it. */
export function PaymentFollowUp({ rows, today, officerName }: { rows: PaymentRow[]; today: string; officerName: string }) {
  const pending = rows.filter((r) => r.remitStatus === "pending");
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function start() {
    const d = draft(pending, today, officerName);
    setTo(read(TO_KEY));
    setCc(read(CC_KEY));
    setSubject(d.subject);
    setBody(d.body);
    setStatus(null);
    setOpen(true);
  }

  async function send() {
    const toList = split(to);
    if (!toList.length) return setStatus({ kind: "err", text: "Enter the manufacturer's e-mail address." });
    setBusy(true);
    const r = await sendDirectMail({ kind: "payment-follow-up", to: toList, cc: split(cc), subject, text: body });
    setBusy(false);
    if (r.error) return setStatus({ kind: "err", text: r.error });
    write(TO_KEY, to);
    write(CC_KEY, cc);
    setStatus({ kind: "ok", text: `Sent to ${toList.join(", ")}.` });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setStatus({ kind: "ok", text: "Copied - paste it into your e-mail." });
    } catch {
      setStatus({ kind: "err", text: "Could not copy - select the text and copy it." });
    }
  }

  const input = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-[14px]";
  return (
    <>
      <button
        type="button"
        disabled={!pending.length}
        onClick={start}
        title={pending.length ? undefined : "No pending payments"}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
      >
        <Glyph name="mail" /> Draft follow-up email
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label="Pending payments follow-up" onClick={() => setOpen(false)}>
          <div className="max-h-[92vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-2xl bg-[var(--surface)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-[17px] font-semibold text-neutral-900">Pending payments follow-up</h3>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-900/[0.05]">
                <Glyph name="close" />
              </button>
            </div>
            <label className="block space-y-1">
              <span className="text-[12px] text-neutral-600">To (manufacturer)</span>
              <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="warranty@manufacturer.com" className={input} />
            </label>
            <label className="block space-y-1">
              <span className="text-[12px] text-neutral-600">Cc (optional)</span>
              <input value={cc} onChange={(e) => setCc(e.target.value)} className={input} />
            </label>
            <label className="block space-y-1">
              <span className="text-[12px] text-neutral-600">Subject</span>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} className={input} />
            </label>
            <label className="block space-y-1">
              <span className="text-[12px] text-neutral-600">Message</span>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} className={`${input} font-mono text-[13px] leading-relaxed`} />
            </label>
            {status && <p className={`text-[13px] ${status.kind === "ok" ? "text-emerald-700" : "text-red-700"}`}>{status.text}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => void copy()} className="rounded-lg bg-neutral-900/[0.06] px-4 py-2 text-[14px] font-medium hover:bg-neutral-900/[0.1]">
                Copy text
              </button>
              <button type="button" disabled={busy} onClick={() => void send()} className="rounded-lg bg-brand px-4 py-2 text-[14px] font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
                {busy ? "Sending…" : "Send from warranty mailbox"}
              </button>
            </div>
            <p className="text-[12px] text-neutral-500">The addresses are remembered on this computer for next month.</p>
          </div>
        </div>
      )}
    </>
  );
}
