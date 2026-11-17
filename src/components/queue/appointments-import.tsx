"use client";

import { useRef, useState, useTransition } from "react";
import { checkAppointmentsMail, uploadAppointments } from "@/app/actions/queue-appointments";

/** Upload the DMS appointments sheet, or read the newest appointments e-mail now. */
export function AppointmentsImport() {
  const input = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={input}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          start(async () => {
            const fd = new FormData();
            fd.set("file", f);
            const r = await uploadAppointments(fd);
            setMsg(r.error ? { text: r.error, bad: true } : { text: `${r.rows} appointments saved${r.skipped ? ` (${r.skipped} rows of an unknown branch skipped)` : ""}.` });
          });
        }}
      />
      <button type="button" disabled={pending} onClick={() => input.current?.click()} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {pending ? "Working…" : "Upload appointments sheet"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await checkAppointmentsMail();
            setMsg(
              r.status === "imported"
                ? { text: `Read "${r.fileName}": ${r.rows} appointments.` }
                : r.status === "unchanged"
                ? { text: "No new appointments e-mail since the last one read." }
                : r.status === "not-found"
                ? { text: "No e-mail with “Appointment” in the subject and an Excel file in the last 4 days.", bad: true }
                : r.status === "not-connected"
                ? { text: "The report mailbox (the one the Warranty Invoicing report is read from) is not connected.", bad: true }
                : { text: r.error, bad: true }
            );
          })
        }
        className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-800 hover:border-brand disabled:opacity-50"
      >
        Check e-mail now
      </button>
      {msg && <span className={`text-sm ${msg.bad ? "text-red-600" : "text-emerald-700"}`}>{msg.text}</span>}
    </div>
  );
}
