"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closeVerificationRequest } from "@/app/actions/verification-requests";
import { CopyText } from "./copy-text";

export type VerificationRow = {
  id: string;
  requestNo: number;
  branch: string;
  vin: string;
  mileage: number | null;
  moduleName: string;
  reason: string;
  status: "open" | "closed";
  code: string | null;
  createdBy: string | null;
  createdAt: string;
  closedBy: string | null;
  closedAt: string | null;
  vinPhoto: string | null;
  mileagePhoto: string | null;
};

const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" });

function AnswerForm({ id }: { id: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="mt-3 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await closeVerificationRequest(id, code);
          if (res.error) setMsg({ ok: false, text: res.error });
          else {
            setMsg({ ok: true, text: res.mailError ? `Closed, but the e-mail failed: ${res.mailError}` : "Closed - the code was e-mailed to the requester." });
            router.refresh();
          }
        });
      }}
    >
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Verification code"
        className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 font-mono text-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
      />
      <button type="submit" disabled={pending || !code.trim()} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50">
        {pending ? "Sending..." : "Send code"}
      </button>
      {msg && <p className={`w-full text-xs ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
    </form>
  );
}

export function RequestList({ rows, canAnswer, showBranch, openId }: { rows: VerificationRow[]; canAnswer: boolean; showBranch: boolean; openId?: string }) {
  const [filter, setFilter] = useState<"open" | "closed" | "all">("open");
  const shown = rows.filter((r) => filter === "all" || r.status === filter);
  const openCount = rows.filter((r) => r.status === "open").length;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(["open", "closed", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === f ? "bg-neutral-900 text-white" : "bg-white text-neutral-600 ring-1 ring-neutral-200"}`}
          >
            {f === "open" ? `Open (${openCount})` : f === "closed" ? "Closed" : "All"}
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className="rounded-xl bg-white p-6 text-center text-sm text-neutral-500 ring-1 ring-neutral-200/70">No requests here.</p>}
      {shown.map((r) => (
        <article key={r.id} id={r.id} className={`rounded-xl bg-white p-4 shadow-sm ring-1 ${openId === r.id ? "ring-2 ring-brand" : "ring-neutral-200/70"}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-xs text-neutral-500">
                #{r.requestNo} · {fmt(r.createdAt)} · {r.createdBy}
                {showBranch && r.branch && <> · {r.branch}</>}
              </div>
              <div className="font-semibold text-neutral-900">{r.moduleName}</div>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${r.status === "open" ? "bg-amber-50 text-amber-800 ring-1 ring-amber-600/20" : "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600/20"}`}>
              {r.status === "open" ? "Open" : "Closed"}
            </span>
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
          {r.status === "closed" ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm">
              <span className="text-emerald-900">Verification code:</span>
              <CopyText value={r.code ?? ""} mono />
              <span className="text-xs text-emerald-800">
                by {r.closedBy} · {r.closedAt ? fmt(r.closedAt) : ""}
              </span>
            </div>
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
