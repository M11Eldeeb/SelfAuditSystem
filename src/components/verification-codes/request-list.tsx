"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closeVerificationRequest, rejectVerificationRequest } from "@/app/actions/verification-requests";
import { CopyText } from "./copy-text";

export type VerificationRow = {
  id: string;
  requestNo: number;
  branch: string;
  vin: string;
  mileage: number | null;
  moduleName: string;
  reason: string;
  status: "open" | "closed" | "rejected";
  code: string | null;
  rejectReason: string | null;
  createdBy: string | null;
  createdAt: string;
  closedBy: string | null;
  closedAt: string | null;
  vinPhoto: string | null;
  mileagePhoto: string | null;
};

/** "19 Oct 2026, 14:05" in Saudi time. */
const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Riyadh" });

/** "3 h 20 min" / "2 d 4 h" between two moments (until now while open). */
function leadTime(fromIso: string, toIso: string | null): string {
  const mins = Math.max(0, Math.round(((toIso ? Date.parse(toIso) : Date.now()) - Date.parse(fromIso)) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} h ${mins % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

const STATUS = {
  open: { label: "Open", cls: "bg-amber-50 text-amber-800 ring-amber-600/20" },
  closed: { label: "Code sent", cls: "bg-emerald-50 text-emerald-800 ring-emerald-600/20" },
  rejected: { label: "Rejected", cls: "bg-red-50 text-red-700 ring-red-600/20" },
} as const;

function AnswerForm({ id }: { id: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"code" | "reject">("code");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const rejecting = mode === "reject";
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = rejecting ? await rejectVerificationRequest(id, text) : await closeVerificationRequest(id, text);
          if (res.error) setMsg({ ok: false, text: res.error });
          else {
            const done = rejecting ? "Rejected - the reason was e-mailed to the requester." : "Closed - the code was e-mailed to the requester.";
            setMsg({ ok: true, text: res.mailError ? `${rejecting ? "Rejected" : "Closed"}, but the e-mail failed: ${res.mailError}` : done });
            router.refresh();
          }
        });
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {rejecting ? (
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Reason for rejecting"
            className="min-w-0 flex-1 rounded-lg border border-red-300 px-3 py-2 text-sm focus:border-red-500 focus:ring-2 focus:ring-red-500/15 focus:outline-none"
          />
        ) : (
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Verification code"
            className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 font-mono text-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
          />
        )}
        <button
          type="submit"
          disabled={pending || !text.trim()}
          className={`rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50 ${rejecting ? "bg-red-600 hover:bg-red-700" : "bg-brand hover:bg-brand-dark"}`}
        >
          {pending ? "Sending..." : rejecting ? "Reject" : "Send code"}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode(rejecting ? "code" : "reject");
            setText("");
            setMsg(null);
          }}
          className="text-xs font-medium text-neutral-500 underline hover:text-neutral-800"
        >
          {rejecting ? "Send a code instead" : "Reject with reason"}
        </button>
      </div>
      {msg && <p className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
    </form>
  );
}

export function RequestList({ rows, canAnswer, showBranch, openId }: { rows: VerificationRow[]; canAnswer: boolean; showBranch: boolean; openId?: string }) {
  const [filter, setFilter] = useState<"open" | "done" | "all">("open");
  const shown = rows.filter((r) => filter === "all" || (filter === "open" ? r.status === "open" : r.status !== "open"));
  const openCount = rows.filter((r) => r.status === "open").length;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(["open", "done", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === f ? "bg-neutral-900 text-white" : "bg-white text-neutral-600 ring-1 ring-neutral-200"}`}
          >
            {f === "open" ? `Open (${openCount})` : f === "done" ? "Answered" : "All"}
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className="rounded-xl bg-white p-6 text-center text-sm text-neutral-500 ring-1 ring-neutral-200/70">No requests here.</p>}
      {shown.map((r) => (
        <article key={r.id} id={r.id} className={`rounded-xl bg-white p-4 shadow-sm ring-1 ${openId === r.id ? "ring-2 ring-brand" : "ring-neutral-200/70"}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-xs text-neutral-500">
                VC-{String(r.requestNo).padStart(4, "0")} · {r.createdBy}
                {showBranch && r.branch && <> · {r.branch}</>}
              </div>
              <div className="font-semibold text-neutral-900">{r.moduleName}</div>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
          </div>
          <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-xs text-neutral-500">VIN</span>
              <CopyText value={r.vin} mono />
              {r.vinPhoto && (
                <a href={r.vinPhoto} target="_blank" rel="noreferrer" className="text-xs text-brand underline">
                  photo
                </a>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-xs text-neutral-500">Mileage</span>
              {r.mileage != null ? <CopyText value={String(r.mileage)} label={`${r.mileage.toLocaleString("en-US")} km`} /> : "—"}
              {r.mileagePhoto && (
                <a href={r.mileagePhoto} target="_blank" rel="noreferrer" className="text-xs text-brand underline">
                  photo
                </a>
              )}
            </div>
          </div>
          <p className="mt-2 text-sm whitespace-pre-wrap text-neutral-700">
            <span className="text-xs text-neutral-500">Reason: </span>
            {r.reason}
          </p>

          <dl className="mt-3 grid gap-x-4 gap-y-1 rounded-lg bg-neutral-50 px-3 py-2 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-neutral-500">Submitted</dt>
              <dd className="font-medium text-neutral-900">{stamp(r.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">{r.status === "rejected" ? "Rejected" : r.status === "closed" ? "Code sent" : "Answered"}</dt>
              <dd className="font-medium text-neutral-900">
                {r.closedAt ? stamp(r.closedAt) : "—"}
                {r.closedBy && <span className="font-normal text-neutral-500"> · {r.closedBy}</span>}
              </dd>
            </div>
            <div>
              <dt className="text-neutral-500">{r.status === "open" ? "Waiting for" : "Lead time"}</dt>
              <dd className={`font-semibold ${r.status === "open" ? "text-amber-700" : "text-neutral-900"}`}>{leadTime(r.createdAt, r.closedAt)}</dd>
            </div>
          </dl>

          {r.status === "closed" ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm">
              <span className="text-emerald-900">Verification code:</span>
              <CopyText value={r.code ?? ""} mono />
            </div>
          ) : r.status === "rejected" ? (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              <span className="font-semibold">Rejected: </span>
              {r.rejectReason}
            </p>
          ) : canAnswer ? (
            <AnswerForm id={r.id} />
          ) : (
            <p className="mt-3 text-xs text-neutral-500">Waiting for the technical team - you will get the code by e-mail.</p>
          )}
        </article>
      ))}
    </section>
  );
}
