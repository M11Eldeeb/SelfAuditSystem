"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignTechnicalInquiry, cancelTechnicalInquiry, resubmitTechnicalInquiry } from "@/app/actions/technical-inquiries";
import { INQUIRY_TEXT_MAX, type InquiryStatus } from "@/lib/technical-inquiries";

const textareaClass =
  "w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none disabled:opacity-60";

/**
 * For the workshop (and officers acting for it): withdraw a case that is still open, or send a closed / cancelled case
 * back to the technical team when the problem came back.
 */
export function WorkshopActions({ inquiryId, status }: { inquiryId: string; status: InquiryStatus }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const canCancel = status === "open" || status === "awaiting_workshop";
  const canResubmit = status === "closed" || status === "cancelled";
  if (!canCancel && !canResubmit) return null;

  function run(action: () => Promise<{ error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.error) return setError(res.error);
      setText("");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <section className="space-y-3 rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">{canCancel ? "No longer needed?" : status === "closed" ? "Did the problem come back?" : "Cancelled by mistake?"}</h2>
          <p className="text-xs text-neutral-500">
            {canCancel ? "Cancel the case and the technical team stops working on it." : "Send the case back to the technical team with a note about what changed."}
          </p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition ${canCancel ? "border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50" : "bg-brand text-white shadow-brand/25 hover:bg-brand-dark"}`}
          >
            {canCancel ? "Cancel the case" : "Send it again"}
          </button>
        )}
      </div>
      {open && (
        <div className="space-y-2">
          <label htmlFor="ti-workshop-action" className="text-xs font-medium text-neutral-700">
            {canCancel ? "Why is it cancelled? (optional)" : "What has changed, or why are you sending it again?"}
          </label>
          <textarea
            id="ti-workshop-action"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={INQUIRY_TEXT_MAX}
            rows={3}
            disabled={pending}
            placeholder={canCancel ? "e.g. The customer collected the car, the fault was a loose connector" : "e.g. The fault came back after 300 km with the same code"}
            className={textareaClass}
          />
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pending || (canResubmit && !text.trim())}
              onClick={() => run(() => (canCancel ? cancelTechnicalInquiry({ inquiryId, reason: text }) : resubmitTechnicalInquiry({ inquiryId, comment: text })))}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition hover:bg-brand-dark disabled:opacity-50"
            >
              {pending ? "Saving..." : canCancel ? "Cancel the case" : "Send to the technical team"}
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={pending} className="rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100">
              Not now
            </button>
          </div>
        </div>
      )}
      {!open && error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * For the technical team: who looks after this case. The first technician who opens an unassigned case gets it; any
 * technician can delegate it to a colleague here (the colleague is told by mail when the mail is switched on), or take it
 * over. Officers can assign it too.
 */
export function AssignPanel({
  inquiryId,
  assignedTo,
  assignedName,
  technicians,
  meId,
}: {
  inquiryId: string;
  assignedTo: string | null;
  assignedName: string | null;
  technicians: { id: string; name: string }[];
  /** The signed-in user, when they are a technician (so "Take this case" is offered). */
  meId: string | null;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const others = technicians.filter((t) => t.id !== assignedTo);
  const mine = !!meId && assignedTo === meId;

  function assign(userId: string) {
    setError(null);
    startTransition(async () => {
      const res = await assignTechnicalInquiry({ inquiryId, userId });
      if (res.error) return setError(res.error);
      setChoice("");
      router.refresh();
    });
  }

  return (
    <section className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-neutral-200/70 bg-white px-4 py-3 shadow-sm">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-neutral-900">Technician</p>
        <p className="text-xs text-neutral-500">{assignedName ? (mine ? "This case is assigned to you" : `Assigned to ${assignedName}`) : "Nobody is looking after this case yet"}</p>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {meId && !mine && technicians.some((t) => t.id === meId) && (
          <button
            type="button"
            onClick={() => assign(meId)}
            disabled={pending}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition hover:bg-brand-dark disabled:opacity-50"
          >
            Take this case
          </button>
        )}
        {others.length > 0 && (
          <>
            <select
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              disabled={pending}
              aria-label={assignedTo ? "Delegate the case to" : "Assign the case to"}
              className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-900 shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
            >
              <option value="">{assignedTo ? "Delegate to another technician" : "Choose a technician"}</option>
              {others.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => choice && assign(choice)}
              disabled={pending || !choice}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-semibold text-neutral-800 shadow-sm transition hover:bg-neutral-50 disabled:opacity-50"
            >
              {assignedTo ? "Delegate" : "Assign"}
            </button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="w-full text-sm text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}
