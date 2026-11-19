"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  assignTicket,
  callNextCustomer,
  completeTicket,
  getDeskBoard,
  holdTicket,
  markNoShow,
  pinTicket,
  reactivateTicket,
  returnToQueue,
  saveTicketNotes,
  serveTicket,
  transferToManager,
  type DeskBoard,
} from "@/app/actions/queue";
import { MODE_LABEL, callOrder, lateMinutes, minutesSince, serviceText, type QueueTicket } from "@/lib/queue/core";
import { usePolling } from "./alerts";
import { receivingText } from "@/lib/queue/hours";
import { Spinner } from "./public-shell";

const btn = "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50";
const primary = `${btn} bg-brand text-white shadow-sm hover:bg-brand-dark`;
const ghost = `${btn} border border-neutral-200 bg-white text-neutral-800 hover:border-brand hover:text-brand`;

/** The appointment's time of day (Saudi time), e.g. 14:30. */
const apptTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" });

function clockSince(iso: string | null, now: number) {
  const s = iso ? Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000)) : 0;
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** A service or spare parts desk: the waiting list, Call next / Serve now, and the customer being served. */
export function Desk({ branch, kind, initial }: { branch: { id: string; name: string; code: string }; kind: "service" | "parts"; initial: DeskBoard }) {
  const [board, setBoard] = useState<DeskBoard>(initial);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);
  const [completing, setCompleting] = useState<QueueTicket | null>(null);
  const [assigning, setAssigning] = useState<{ ticket: QueueTicket; advisorId: string } | null>(null);
  const [, startTransition] = useTransition();

  const manager = board.me.role === "manager";
  const showList = manager || kind === "parts";

  const refresh = useCallback(async () => {
    const b = await getDeskBoard(branch.id, kind);
    if (!("error" in b)) startTransition(() => setBoard(b));
  }, [branch.id, kind]);
  usePolling(refresh, 3000);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(null), 3500);
    return () => clearTimeout(id);
  }, [message]);

  async function run(key: string, fn: () => Promise<{ error?: string } & Record<string, unknown>>, ok?: string) {
    setBusy(key);
    try {
      const r = await fn();
      if (r.error) setMessage({ text: r.error, bad: true });
      else if (ok) setMessage({ text: ok });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  const mine = board.active.filter((tk) => tk.advisor_id === board.me.id);
  const others = board.active.filter((tk) => tk.advisor_id !== board.me.id);
  // The waiting list in the order it will be called (moved to the front first).
  const ordered = callOrder(board.waiting, board.settings);
  const nextUp = ordered[0];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-lg bg-neutral-900 px-3 py-1.5 font-semibold text-white">
            {kind === "parts" ? "🧰 Spare parts" : "📋 Service"} · {branch.name}
          </span>
          <span className="text-neutral-600">
            <strong className="text-neutral-900">{board.waiting.length}</strong> waiting
          </span>
          <span className="text-neutral-600">
            <strong className="text-neutral-900">{board.servedToday}</strong> served today
          </span>
          {showList && nextUp && (
            <span className="text-neutral-600">
              Next in line: <strong className="text-neutral-900">{nextUp.ticket_number}</strong>
            </span>
          )}
        </div>
        <span className="flex items-center gap-2">
          <span
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ${board.receiving.open ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-red-50 text-red-700 ring-red-200"}`}
            title="Set by the reception manager in Queue settings"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${board.receiving.open ? "bg-emerald-500" : "bg-red-500"}`} />
            {receivingText(board.receiving, "en")}
          </span>
          <span className="flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-600">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> Live
          </span>
        </span>
      </div>

      <div className="grid gap-5 lg:grid-cols-12">
        <section className="space-y-4 lg:col-span-5">
          {(kind === "service" || mine.length === 0) && (
            <div className="flex flex-col items-center gap-3 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-neutral-200/70">
              <button
                type="button"
                onClick={() => run("next", () => callNextCustomer(branch.id, kind), "Customer called.")}
                disabled={!!busy || board.waiting.length === 0}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-6 py-4 text-base font-bold text-white shadow-[0_4px_14px_rgba(196,18,26,0.3)] disabled:opacity-40"
              >
                {busy === "next" ? <Spinner /> : "📣"} Call next customer
              </button>
              <p className="text-xs text-neutral-500">
                {kind === "service"
                  ? "Picks the right customer for you by the branch's queue settings."
                  : "Calls the customer waiting longest (or one reserved for you)."}
              </p>
            </div>
          )}

          {showList && (
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
              <h2 className="mb-3 flex items-center justify-between text-sm font-semibold text-neutral-900">
                Waiting
                <span className="rounded-md bg-brand/10 px-2 py-0.5 text-xs text-brand">{board.waiting.length}</span>
              </h2>
              {board.waiting.length === 0 ? (
                <p className="py-8 text-center text-sm text-neutral-400">No one waiting.</p>
              ) : (
                <ul className="max-h-[60vh] space-y-2 overflow-y-auto pe-1">
                  {ordered.map((tk) => (
                    <li key={tk.id} className={`rounded-xl border p-3 ${tk.service_mode === "appointment" ? "border-s-4 border-s-brand border-neutral-200" : "border-neutral-200"}`}>
                      <div className="flex items-start gap-3">
                        <div className="w-14 shrink-0 text-center">
                          <div className="text-[10px] uppercase text-neutral-400">Ticket</div>
                          <div className="font-bold text-neutral-900">{tk.ticket_number}</div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate font-semibold text-neutral-900">{tk.customer_name}</span>
                            {tk.service_mode === "appointment" && <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] text-brand">Appointment{tk.appointment_at && ` ${apptTime(tk.appointment_at)}`}</span>}
                            {tk.was_held && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">Back from hold</span>}
                            {lateMinutes(tk) && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-red-200">Late {lateMinutes(tk)} min</span>}
                            {tk.pinned_at && <span className="rounded-full bg-neutral-900 px-2 py-0.5 text-[11px] font-medium text-white">Moved to front</span>}
                            {tk.preassign_urgent && tk.preassigned_advisor_id && <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] text-white">Urgent</span>}
                          </div>
                          <div className="mt-0.5 text-xs text-neutral-500">
                            {serviceText(tk, "en")} · ⏱ {minutesSince(tk.queue_entry_at, now)} min
                            {tk.wip_number && <span dir="ltr"> · WIP {tk.wip_number}</span>}
                          </div>
                          {tk.preassigned_advisor_name && <div className="mt-0.5 text-xs font-medium text-brand">→ {tk.preassigned_advisor_name}</div>}
                          <CustomerAdded tk={tk} compact />
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <button type="button" onClick={() => run(tk.id, () => serveTicket(tk.id), "Customer called.")} disabled={!!busy} className={`${primary} px-2.5 py-1.5 text-xs`}>
                            {busy === tk.id && <Spinner size={12} />} Serve now
                          </button>
                          {manager && (
                            <button
                              type="button"
                              disabled={!!busy}
                              onClick={() => run(tk.id, () => pinTicket(tk.id, !tk.pinned_at), tk.pinned_at ? "Back in the normal order." : "Moved to the front - called next.")}
                              className="text-[11px] font-semibold text-neutral-600 hover:text-brand hover:underline disabled:opacity-50"
                            >
                              {tk.pinned_at ? "Undo move" : "⤒ Move to front"}
                            </button>
                          )}
                          {manager && board.advisors.length > 0 && (
                            <select
                              value={tk.preassigned_advisor_id ?? ""}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (!v) void run(tk.id, () => assignTicket(tk.id, null, false), "Assignment cleared.");
                                else setAssigning({ ticket: tk, advisorId: v });
                              }}
                              className="max-w-[140px] rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-[11px] text-neutral-700"
                            >
                              <option value="">Assign to…</option>
                              {board.advisors.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {manager && (board.noShows.length > 0 || board.held.length > 0) && (
            <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
              {board.held.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">On hold - 24 hours (the customer can also rejoin)</p>
                  <ul className="space-y-1.5">
                    {board.held.map((tk) => (
                      <li key={tk.id} className="flex items-center justify-between gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-sm">
                        <span className="truncate">
                          {tk.ticket_number} · {tk.customer_name}
                        </span>
                        <button type="button" onClick={() => run(tk.id, () => reactivateTicket(tk.id), "Back in the queue with priority.")} disabled={!!busy} className="shrink-0 text-xs font-semibold text-brand hover:underline">
                          Reactivate
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {board.noShows.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">No-shows today</p>
                  <ul className="space-y-1.5">
                    {board.noShows.map((tk) => (
                      <li key={tk.id} className="flex items-center justify-between gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-sm">
                        <span className="truncate">
                          {tk.ticket_number} · {tk.customer_name}
                        </span>
                        <button type="button" onClick={() => run(tk.id, () => returnToQueue(tk.id), "Returned to the queue.")} disabled={!!busy} className="shrink-0 text-xs font-semibold text-brand hover:underline">
                          Return to queue
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="space-y-4 lg:col-span-7">
          {mine.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-white p-10 text-center shadow-sm ring-1 ring-neutral-200/70">
              <span className="text-3xl">🪑</span>
              <p className="font-semibold text-neutral-700">No customer with you</p>
              <p className="max-w-xs text-sm text-neutral-500">{showList ? "Call next customer, or Serve now on a waiting ticket." : "Call next customer to start."}</p>
            </div>
          ) : (
            mine.map((tk) => (
              <Session
                key={tk.id}
                tk={tk}
                now={now}
                busy={busy}
                onComplete={() => setCompleting(tk)}
                onNoShow={() => run(tk.id, () => markNoShow(tk.id), "Marked as no-show.")}
                onHold={() => run(tk.id, () => holdTicket(tk.id), "On hold for 24 hours.")}
                onTransfer={() => run(tk.id, () => transferToManager(tk.id), "Handed to the manager.")}
                onRecall={() => run(tk.id, () => returnToQueue(tk.id), "Back in the queue.")}
              />
            ))
          )}

          {manager && others.length > 0 && (
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
              <h2 className="mb-2 text-sm font-semibold text-neutral-900">With other advisors now</h2>
              <ul className="divide-y divide-neutral-100 text-sm">
                {others.map((tk) => (
                  <li key={tk.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="truncate">
                      <strong>{tk.ticket_number}</strong> · {tk.customer_name}
                    </span>
                    <span className="shrink-0 text-xs text-neutral-500">
                      {tk.advisor_name} · {clockSince(tk.served_at, now)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      {completing && (
        <CompleteDialog
          tk={completing}
          parts={kind === "parts"}
          onCancel={() => setCompleting(null)}
          onDone={async (wip) => {
            const id = completing.id;
            setCompleting(null);
            await run(id, () => completeTicket(id, wip), "Completed.");
          }}
        />
      )}

      {assigning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-neutral-900">
              {assigning.ticket.ticket_number} to {board.advisors.find((a) => a.id === assigning.advisorId)?.name}
            </h2>
            <div className="grid gap-2">
              {[
                { urgent: true, title: "Urgent", text: "Served next by this advisor." },
                { urgent: false, title: "Normal turn", text: "Stays in line; only this advisor serves them." },
              ].map((o) => (
                <button
                  key={o.title}
                  type="button"
                  onClick={() => {
                    const x = assigning;
                    setAssigning(null);
                    void run(x.ticket.id, () => assignTicket(x.ticket.id, x.advisorId, o.urgent), o.urgent ? "Assigned - urgent." : "Reserved in normal turn.");
                  }}
                  className="rounded-xl border border-neutral-200 p-3 text-start hover:border-brand hover:bg-brand/5"
                >
                  <div className="font-semibold text-neutral-900">{o.title}</div>
                  <div className="text-sm text-neutral-500">{o.text}</div>
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setAssigning(null)} className={`${ghost} w-full`}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {message && (
        <div className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-medium text-white shadow-lg ${message.bad ? "bg-red-600" : "bg-neutral-900"}`} role="status">
          {message.text}
        </div>
      )}
    </div>
  );
}

function Session({
  tk,
  now,
  busy,
  onComplete,
  onNoShow,
  onHold,
  onTransfer,
  onRecall,
}: {
  tk: QueueTicket;
  now: number;
  busy: string | null;
  onComplete: () => void;
  onNoShow: () => void;
  onHold: () => void;
  onTransfer: () => void;
  onRecall: () => void;
}) {
  const [notes, setNotes] = useState(tk.notes ?? "");
  const [saved, setSaved] = useState(true);
  const off = busy === tk.id;
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-200/70 sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <span className="text-xs font-bold uppercase tracking-widest text-brand">With you now</span>
          <h2 className="text-3xl font-bold text-neutral-900">{tk.ticket_number}</h2>
        </div>
        <div className="rounded-xl px-4 py-2 text-end ring-1 ring-brand/20">
          <div className="text-2xl font-bold tabular-nums text-brand">{clockSince(tk.served_at, now)}</div>
          <span className="text-[11px] uppercase tracking-wide text-neutral-500">Duration</span>
        </div>
      </div>
      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <Info label="Customer" value={tk.customer_name} />
        <Info label="Service" value={serviceText(tk, "en")} />
        <Info label="Mobile" value={tk.mobile} ltr href={`tel:${tk.mobile}`} />
        {tk.appointment_at && <Info label="Appointment time" value={`${apptTime(tk.appointment_at)}${lateMinutes(tk) ? ` · came ${lateMinutes(tk)} min late` : ""}`} />}
        <Info
          label={tk.service_mode === "appointment" ? MODE_LABEL.appointment[0] : "Joined"}
          value={`${minutesSince(tk.queue_entry_at, now)} min ago${tk.wip_number ? ` · WIP ${tk.wip_number}` : ""}`}
        />
      </div>
      <CustomerAdded tk={tk} />
      <label className="mb-5 block">
        <span className="mb-1 flex items-center justify-between text-sm font-semibold text-neutral-800">
          Notes {!saved && <span className="text-xs font-normal text-neutral-400">saving…</span>}
        </span>
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setSaved(false);
          }}
          onBlur={async () => {
            if (saved) return;
            await saveTicketNotes(tk.id, notes);
            setSaved(true);
          }}
          rows={3}
          placeholder="Service details or customer requests…"
          className="w-full resize-none rounded-xl border border-neutral-200 bg-white p-3 text-sm outline-none focus:border-brand"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onComplete} disabled={off} className={`${primary} flex-1 py-3 text-base`}>
          Complete
        </button>
        <button type="button" onClick={onNoShow} disabled={off} className={ghost}>
          🚫 No show
        </button>
        {tk.service_mode !== "spare_parts" && (
          <>
            <button type="button" onClick={onHold} disabled={off} className={ghost}>
              ⏸️ Hold
            </button>
            <button type="button" onClick={onTransfer} disabled={off} className={ghost}>
              🔀 To manager
            </button>
          </>
        )}
        <button type="button" onClick={onRecall} disabled={off} className={ghost} title="Put the customer back at the end of the line">
          ↩ Back to queue
        </button>
      </div>
    </div>
  );
}

const SERVICE_NAMES: Record<string, string> = { quick_service: "Quick Service", general_repair: "General Repair", vehicle_delivery: "Vehicle delivery" };
const listText = (v: unknown) => (Array.isArray(v) ? v.map((s) => SERVICE_NAMES[String(s)] ?? String(s)).join(" + ") : String(v ?? "—"));

/** What the customer changed at the kiosk from the appointment sheet, and their note for the advisor. */
function CustomerAdded({ tk, compact }: { tk: QueueTicket; compact?: boolean }) {
  const changes = tk.customer_changes ?? {};
  const keys = Object.keys(changes);
  if (!tk.customer_note && !keys.length) return null;
  if (compact)
    return (
      <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
        {keys.length > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">✏️ Changed by customer</span>}
        {tk.customer_note && <span className="rounded-full bg-sky-100 px-2 py-0.5 font-medium text-sky-800">📝 Has a note</span>}
      </div>
    );
  return (
    <div className="mb-5 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="font-semibold">From the customer at the kiosk</p>
      {changes.services && (
        <p>
          Service changed: <s className="opacity-70">{listText(changes.services.from)}</s> → <strong>{listText(changes.services.to)}</strong>
        </p>
      )}
      {changes.name && (
        <p>
          Name changed: <s className="opacity-70">{String(changes.name.from)}</s> → <strong>{String(changes.name.to)}</strong>
        </p>
      )}
      {tk.customer_note && (
        <p>
          📝 <strong>Note:</strong> {tk.customer_note}
        </p>
      )}
    </div>
  );
}

function Info({ label, value, ltr, href }: { label: string; value: string; ltr?: boolean; href?: string }) {
  return (
    <div className="rounded-xl bg-neutral-50 p-3">
      <div className="text-xs text-neutral-500">{label}</div>
      {href ? (
        <a href={href} className="font-semibold text-neutral-900 underline-offset-2 hover:underline" dir={ltr ? "ltr" : undefined}>
          {value}
        </a>
      ) : (
        <div className="font-semibold text-neutral-900" dir={ltr ? "ltr" : undefined}>
          {value}
        </div>
      )}
    </div>
  );
}

function CompleteDialog({ tk, parts, onCancel, onDone }: { tk: QueueTicket; parts: boolean; onCancel: () => void; onDone: (wip: string) => void }) {
  const [wip, setWip] = useState(tk.wip_number ?? "");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-neutral-900">Complete {tk.ticket_number}</h2>
        {parts ? (
          <p className="mt-1 text-sm text-neutral-500">Mark this parts request as done.</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-neutral-500">The WIP number of this job (optional).</p>
            <input value={wip} onChange={(e) => setWip(e.target.value)} dir="ltr" inputMode="numeric" placeholder="WIP number" className="mt-3 h-11 w-full rounded-lg border border-neutral-200 px-3 outline-none focus:border-brand" autoFocus />
          </>
        )}
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onCancel} className={`${ghost} flex-1`}>
            Cancel
          </button>
          <button type="button" onClick={() => onDone(wip)} className={`${primary} flex-1`}>
            Complete
          </button>
        </div>
      </div>
    </div>
  );
}
