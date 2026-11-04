"use client";

import { useState } from "react";
import { savePartCheck, saveClaimPartsAnswers, type PartCheck } from "./actions";

/**
 * The pre-visit part check of one audit claim: verified by serial number or offline date, what was found (compared
 * with the claim's value) and a note. Used in the Claims list and on the audit's claim page.
 */
export function PartCheckEditor({
  internalClaimId,
  expectedSerial,
  expectedOffline,
  initial,
  checkedAt,
  checkedBy,
  locked,
  onSaved,
}: {
  internalClaimId: string;
  expectedSerial: string | null;
  expectedOffline: string | null;
  initial: PartCheck;
  checkedAt: string | null;
  checkedBy: string | null;
  locked: boolean;
  onSaved?: (check: PartCheck, at: string | null, by: string | null) => void;
}) {
  const [saved, setSaved] = useState(initial);
  const [check, setCheck] = useState<PartCheck>({ ...initial, method: initial.method ?? (expectedSerial ? "serial" : expectedOffline ? "offline" : null) });
  const [stamp, setStamp] = useState({ at: checkedAt, by: checkedBy });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(check) !== JSON.stringify(saved);

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await savePartCheck(internalClaimId, check);
    setBusy(false);
    if (res.error) return setMsg({ ok: false, text: res.error });
    setSaved(check);
    setStamp({ at: res.at ?? null, by: res.by ?? null });
    onSaved?.(check, res.at ?? null, res.by ?? null);
    setMsg({ ok: true, text: "Saved." });
  }

  const serialMatch = check.method === "serial" && check.serial && expectedSerial ? check.serial.trim().toUpperCase() === expectedSerial.trim().toUpperCase() : null;
  const offlineMatch = check.method === "offline" && check.offlineDate && expectedOffline ? check.offlineDate === expectedOffline.slice(0, 10) : null;

  return (
    <div className="space-y-2 rounded-lg bg-white p-3 text-sm ring-1 ring-neutral-200" onClick={(e) => e.stopPropagation()}>
      <div className="text-xs font-semibold text-neutral-900">Part check</div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-neutral-500">Serial number (claim)</div>
          <div className="font-mono font-medium">{expectedSerial || "—"}</div>
        </div>
        <div>
          <div className="text-neutral-500">Offline date (claim)</div>
          <div className="font-medium">{expectedOffline?.slice(0, 10) || "—"}</div>
        </div>
      </div>
      <div className="inline-flex rounded-lg bg-neutral-900/[0.05] p-0.5 text-xs font-medium" role="group" aria-label="Verified by">
        {(
          [
            ["serial", "Serial number"],
            ["offline", "Offline date"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" disabled={locked} aria-pressed={check.method === k} onClick={() => setCheck((c) => ({ ...c, method: k }))} className={`rounded-md px-3 py-1 ${check.method === k ? "bg-white shadow-sm" : "text-neutral-600"}`}>
            {l}
          </button>
        ))}
      </div>
      {check.method === "serial" && (
        <label className="block space-y-1">
          <span className="text-xs text-neutral-500">Serial number found</span>
          <input value={check.serial ?? ""} disabled={locked} onChange={(e) => setCheck((c) => ({ ...c, serial: e.target.value }))} className="w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 font-mono text-sm" placeholder="Part serial number" />
          {serialMatch != null && <span className={`text-xs font-semibold ${serialMatch ? "text-emerald-700" : "text-red-700"}`}>{serialMatch ? "Matches the claim" : "Does not match the claim"}</span>}
        </label>
      )}
      {check.method === "offline" && (
        <label className="block space-y-1">
          <span className="text-xs text-neutral-500">Offline date found</span>
          <input type="date" value={check.offlineDate ?? ""} disabled={locked} onChange={(e) => setCheck((c) => ({ ...c, offlineDate: e.target.value || null }))} className="w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm" />
          {offlineMatch != null && <span className={`text-xs font-semibold ${offlineMatch ? "text-emerald-700" : "text-red-700"}`}>{offlineMatch ? "Matches the claim" : "Does not match the claim"}</span>}
        </label>
      )}
      <textarea value={check.note ?? ""} disabled={locked} onChange={(e) => setCheck((c) => ({ ...c, note: e.target.value }))} rows={2} placeholder="Note (optional)" className="w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm" />
      <div className="flex items-center gap-3">
        {!locked && (
          <button type="button" disabled={busy || !dirty} onClick={() => void save()} className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
            {busy ? "Saving…" : "Save part check"}
          </button>
        )}
        {msg && <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</span>}
        {stamp.at && (
          <span className="text-xs text-neutral-400">
            {stamp.by} · {stamp.at.slice(0, 10)}
          </span>
        )}
      </div>
    </div>
  );
}

export type PartsQuestion = { id: string; text: string; options: string[] };

/** The audit's parts questions (availability, serial recorded, tag...) for one claim, scored and saved in place. */
export function PartsQuestionsEditor({
  auditId,
  internalClaimId,
  questions,
  initial,
  locked,
  onSaved,
}: {
  auditId: string;
  internalClaimId: string;
  questions: PartsQuestion[];
  initial: Record<string, string>;
  locked: boolean;
  onSaved?: (answers: Record<string, string>) => void;
}) {
  const [saved, setSaved] = useState(initial);
  const [answers, setAnswers] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(answers) !== JSON.stringify(saved);
  if (!questions.length) return null;

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await saveClaimPartsAnswers(auditId, internalClaimId, answers);
    setBusy(false);
    if (res.error) return setMsg({ ok: false, text: res.error });
    setSaved(answers);
    onSaved?.(answers);
    setMsg({ ok: true, text: "Saved." });
  }

  return (
    <div className="space-y-2 rounded-lg bg-white p-3 text-sm ring-1 ring-neutral-200" onClick={(e) => e.stopPropagation()}>
      <div className="text-xs font-semibold text-neutral-900">Parts audit</div>
      {questions.map((q) => (
        <div key={q.id} className="space-y-1">
          <div className="text-xs text-neutral-700">{q.text}</div>
          <div className="inline-flex flex-wrap gap-1" role="group" aria-label={q.text}>
            {q.options.map((o) => (
              <button
                key={o}
                type="button"
                disabled={locked}
                aria-pressed={answers[q.id] === o}
                onClick={() => setAnswers((a) => ({ ...a, [q.id]: o }))}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ring-1 ${answers[q.id] === o ? "bg-brand text-white ring-brand" : "bg-white text-neutral-700 ring-neutral-300 hover:bg-neutral-50"}`}
              >
                {o}%
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-3">
        {!locked && (
          <button type="button" disabled={busy || !dirty} onClick={() => void save()} className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
            {busy ? "Saving…" : "Save parts audit"}
          </button>
        )}
        {msg && <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
