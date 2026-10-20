"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignTechnicalInquiry, cancelTechnicalInquiry, rejectTechnicalInquiry, resubmitTechnicalInquiry, returnTechnicalInquiry, sendInquiryToSupervisor, verifyTechnicalInquiry } from "@/app/actions/technical-inquiries";
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
  const canCancel = status === "open" || status === "awaiting_workshop" || status === "pending_verification" || status === "returned";
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
 * A team leader's case waits here for the workshop supervisor (or the branch admin): verify it to send it to the technical
 * team, or send it back with the reason. Nobody else can act on it; the team leader just sees that it is waiting.
 */
export function VerifyPanel({ inquiryId, canVerify, submittedBy }: { inquiryId: string; canVerify: boolean; submittedBy: string | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<"verify" | "return" | "reject" | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.error) return setError(res.error);
      setText("");
      setMode(null);
      router.refresh();
    });
  }

  if (!canVerify) {
    return (
      <section className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900 shadow-sm">
        <p className="font-semibold">Waiting for the workshop supervisor</p>
        <p className="mt-0.5 text-xs">This case is not with the technical team yet - the workshop supervisor has to verify it first. You can still add comments for the supervisor below.</p>
      </section>
    );
  }
  return (
    <section className="space-y-3 rounded-xl border border-violet-300 bg-violet-50 p-4 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold text-violet-950">Verify this case</h2>
        <p className="text-xs text-violet-900">
          {submittedBy ?? "A team leader"} submitted it. It reaches the technical team only when you verify it. Check the details, the files and the work orders first.
        </p>
      </div>
      {mode === null ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setMode("verify")} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition hover:bg-brand-dark">
            Verify and send to the technical team
          </button>
          <button type="button" onClick={() => setMode("return")} className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-800 shadow-sm transition hover:bg-neutral-50">
            Return to complete documents / diagnosis
          </button>
          <button type="button" onClick={() => setMode("reject")} className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 shadow-sm transition hover:bg-red-50">
            Reject with a reason
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <label htmlFor="ti-verify-text" className="text-xs font-medium text-neutral-700">
            {mode === "verify"
              ? "A note for the technical team (optional)"
              : mode === "return"
                ? "What is missing? The team leader completes it and sends the case to you again (it is not cancelled)."
                : "Why is the case rejected? The team leader will see this - a rejected case is finished."}
          </label>
          <textarea
            id="ti-verify-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={INQUIRY_TEXT_MAX}
            rows={3}
            disabled={pending}
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
              disabled={pending || (mode !== "verify" && !text.trim())}
              onClick={() =>
                run(() =>
                  mode === "verify"
                    ? verifyTechnicalInquiry({ inquiryId, comment: text })
                    : mode === "return"
                      ? returnTechnicalInquiry({ inquiryId, reason: text })
                      : rejectTechnicalInquiry({ inquiryId, reason: text })
                )
              }
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition disabled:opacity-50 ${mode === "reject" ? "bg-red-600 hover:bg-red-700" : "bg-brand shadow-brand/25 hover:bg-brand-dark"}`}
            >
              {pending ? "Saving..." : mode === "verify" ? "Verify and send" : mode === "return" ? "Return to the team leader" : "Reject the case"}
            </button>
            <button type="button" onClick={() => setMode(null)} disabled={pending} className="rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100">
              Not now
            </button>
          </div>
        </div>
      )}
      {mode === null && error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * For the technical team: who looks after this case. The first technical advisor who opens an unassigned case gets it; any
 * technical advisor can delegate it to a colleague here (the colleague is told by mail when the mail is switched on), or take it
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
  /** The signed-in user, when they are a technical advisor (so "Take this case" is offered). */
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
        <p className="text-sm font-semibold text-neutral-900">Technical advisor</p>
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
              <option value="">{assignedTo ? "Delegate to another technical advisor" : "Choose a technical advisor"}</option>
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

/**
 * A case the supervisor returned to complete documents or diagnosis. The team leader (or anyone on the workshop side) edits
 * it, adds files in a comment, and sends it to the supervisor again; the supervisor can still reject it.
 */
export function ReturnedPanel({
  inquiryId,
  reason,
  returnedBy,
  byTeam,
  canSend,
  canReject,
}: {
  inquiryId: string;
  reason: string | null;
  returnedBy: string | null;
  /** Returned by the technical team: sending it again goes straight back to them. */
  byTeam: boolean;
  canSend: boolean;
  canReject: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"send" | "reject" | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.error) return setError(res.error);
      setText("");
      setMode(null);
      router.refresh();
    });
  }

  return (
    <section className="space-y-3 rounded-xl border border-orange-300 bg-orange-50 p-4 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold text-orange-950">
          Returned{returnedBy ? ` by ${returnedBy}` : ""}
          {byTeam ? " (technical team)" : " (workshop supervisor)"} to complete documents / diagnosis
        </h2>
        {reason && <p className="mt-1 text-sm whitespace-pre-wrap text-orange-950">{reason}</p>}
        <p className="mt-1 text-xs text-orange-900">
          {canSend
            ? `Edit the case details below, add the missing files or results as a comment, then send it ${byTeam ? "back to the technical team" : "to the supervisor again"}.`
            : "Waiting for the team leader to complete it."}
        </p>
      </div>
      {mode === null ? (
        <div className="flex flex-wrap gap-2">
          {canSend && (
            <button type="button" onClick={() => setMode("send")} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition hover:bg-brand-dark">
              {byTeam ? "Send back to the technical team" : "Send to the supervisor again"}
            </button>
          )}
          {canReject && (
            <button type="button" onClick={() => setMode("reject")} className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 shadow-sm transition hover:bg-red-50">
              Reject with a reason
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <label htmlFor="ti-returned-text" className="text-xs font-medium text-neutral-700">
            {mode === "send" ? "What did you complete? (optional)" : "Why is the case rejected?"}
          </label>
          <textarea id="ti-returned-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={INQUIRY_TEXT_MAX} rows={3} disabled={pending} className={textareaClass} />
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pending || (mode === "reject" && !text.trim())}
              onClick={() => run(() => (mode === "send" ? sendInquiryToSupervisor({ inquiryId, comment: text }) : rejectTechnicalInquiry({ inquiryId, reason: text })))}
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition disabled:opacity-50 ${mode === "reject" ? "bg-red-600 hover:bg-red-700" : "bg-brand hover:bg-brand-dark"}`}
            >
              {pending ? "Saving..." : mode === "send" ? (byTeam ? "Send to the technical team" : "Send to the supervisor") : "Reject the case"}
            </button>
            <button type="button" onClick={() => setMode(null)} disabled={pending} className="rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100">
              Not now
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** The technical team returns a case to the team leader to complete documents / diagnosis; it comes straight back to them. */
export function TeamReturnPanel({ inquiryId }: { inquiryId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <section className="space-y-3 rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">Something missing?</h2>
          <p className="text-xs text-neutral-500">Return the case to the team leader to complete documents or diagnosis. When he sends it back it comes straight to you.</p>
        </div>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-orange-300 bg-orange-50 px-4 py-2 text-sm font-semibold text-orange-900 shadow-sm hover:bg-orange-100">
            Return to the team leader
          </button>
        )}
      </div>
      {open && (
        <div className="space-y-2">
          <label htmlFor="ti-team-return" className="text-xs font-medium text-neutral-700">
            What is missing?
          </label>
          <textarea id="ti-team-return" value={text} onChange={(e) => setText(e.target.value)} maxLength={INQUIRY_TEXT_MAX} rows={3} disabled={pending} className={textareaClass} />
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pending || !text.trim()}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const res = await returnTechnicalInquiry({ inquiryId, reason: text });
                  if (res.error) return setError(res.error);
                  setText("");
                  setOpen(false);
                  router.refresh();
                })
              }
              className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-orange-700 disabled:opacity-50"
            >
              {pending ? "Saving..." : "Return to the team leader"}
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={pending} className="rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100">
              Not now
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
