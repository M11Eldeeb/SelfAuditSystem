"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { branchTechnicians, prepareAdminClaimUploads, reassignTechClaim, registerAdminClaimFiles, setTechClaimPartReceived, setTechClaimPriorApproval } from "@/app/actions/tech-claims";
import { uploadToSession } from "./upload";
import { stampPhoto, stampVideo } from "./stamp";
import { Glyph } from "@/components/ui/glyph";

/**
 * Warranty admin: add photos / videos / PDFs to a claim the technician already sent (straight into its Drive folder).
 * Photos and videos get the same stamp as the technician's evidence: his name and the claim's evidence date.
 */
export function AdminAddFiles({ claimId, who, at }: { claimId: string; who: string; at: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function add(list: FileList | null) {
    const picked = Array.from(list ?? []);
    if (!picked.length) return;
    setMsg(null);
    const when = new Date(at);
    const files: File[] = [];
    const notStamped: string[] = [];
    for (const [i, f] of picked.entries()) {
      const step = picked.length > 1 ? ` ${i + 1}/${picked.length}` : "";
      setBusy(`Stamping${step}…`);
      try {
        if (f.type.startsWith("image/")) files.push(await stampPhoto(f, who, when));
        else if (f.type.startsWith("video/")) files.push(await stampVideo(f, who, (p) => setBusy(`Stamping${step} ${p}%…`), when));
        else files.push(f);
      } catch {
        notStamped.push(f.name);
        files.push(f);
      }
    }
    setBusy("Preparing…");
    const prep = await prepareAdminClaimUploads(claimId, files.map((f) => ({ name: f.name, type: f.type, size: f.size })));
    if (prep.error || !prep.sessions) {
      setBusy(null);
      return setMsg({ ok: false, text: prep.error ?? "Could not start the upload." });
    }
    const total = files.reduce((s, f) => s + f.size, 0) || 1;
    const sent = files.map(() => 0);
    const show = () => setBusy(`Uploading ${Math.min(99, Math.round((sent.reduce((s, x) => s + x, 0) / total) * 100))}%…`);
    try {
      const ids: string[] = new Array(files.length);
      let next = 0;
      const worker = async () => {
        while (next < files.length) {
          const i = next++;
          ids[i] = await uploadToSession(prep.sessions![i], files[i], (n) => {
            sent[i] = n;
            show();
          });
        }
      };
      show();
      await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker));
      setBusy("Saving…");
      const reg = await registerAdminClaimFiles(claimId, ids);
      if (reg.error) throw new Error(reg.error);
      setMsg({ ok: true, text: `${reg.added} file${reg.added === 1 ? "" : "s"} added.${notStamped.length ? ` Not stamped (could not be opened): ${notStamped.join(", ")}.` : ""}` });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "The upload failed." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <input ref={input} type="file" multiple accept="image/*,video/*,application/pdf" hidden onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
      <button type="button" disabled={!!busy} onClick={() => input.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-50 disabled:opacity-50">
        <Glyph name="upload" /> {busy ?? "Add files"}
      </button>
      {msg && <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</span>}
    </span>
  );
}

/** Warranty admin: send the claim to another technician of the branch, with what he must do. */
export function ReturnToAnotherTechnician({ claimId }: { claimId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [techs, setTechs] = useState<{ id: string; name: string }[] | null>(null);
  const [pick, setPick] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setOpen(true);
    setError(null);
    if (techs) return;
    const r = await branchTechnicians(claimId);
    if (r.error) setError(r.error);
    setTechs(r.technicians ?? []);
  }

  async function send() {
    if (!pick) return setError("Choose the technician.");
    if (!comment.trim()) return setError("Write what the technician must do.");
    setBusy(true);
    setError(null);
    const r = await reassignTechClaim(claimId, pick, comment);
    setBusy(false);
    if (r.error) return setError(r.error);
    setOpen(false);
    router.refresh();
  }

  if (!open)
    return (
      <button type="button" onClick={() => void start()} className="w-full rounded-lg border border-amber-400 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-800 hover:bg-amber-100">
        Return to another technician
      </button>
    );
  return (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/60 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-amber-900">Return to another technician</span>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-neutral-500 hover:text-neutral-800">
          Cancel
        </button>
      </div>
      {techs == null ? (
        <p className="text-sm text-neutral-500">Loading technicians…</p>
      ) : techs.length === 0 ? (
        <p className="text-sm text-neutral-600">No other technician in this branch.</p>
      ) : (
        <>
          <select value={pick} onChange={(e) => setPick(e.target.value)} className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm" aria-label="Technician">
            <option value="">Choose the technician…</option>
            {techs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="What he must do - required" className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm" />
          <button type="button" disabled={busy} onClick={() => void send()} className="w-full rounded-lg bg-amber-500 px-3 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50">
            {busy ? "Sending…" : "Return to this technician"}
          </button>
        </>
      )}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

/** Warranty admin: label the claim "Prior approval" - a label only, no action follows. */
export function PriorApprovalToggle({ claimId, on }: { claimId: string; on: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        aria-pressed={on}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await setTechClaimPriorApproval(claimId, !on);
          setBusy(false);
          if (r.error) setError(r.error);
          else router.refresh();
        }}
        className={`rounded-lg px-3 py-1.5 text-sm font-semibold ring-1 disabled:opacity-50 ${on ? "bg-violet-600 text-white ring-violet-600 hover:bg-violet-700" : "bg-white text-violet-700 ring-violet-300 hover:bg-violet-50"}`}
      >
        {busy ? "…" : on ? "Prior approval ✓" : "Mark as Prior approval"}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}

/**
 * Warranty admin: "Defective part received?" Yes / No. Optional for every branch; for E7 (Riyadh North) the claim cannot be
 * approved before it is Yes. Others see the answer only.
 */
export function PartReceived({ claimId, on, by, at, required, canSet }: { claimId: string; on: boolean; by: string | null; at: string | null; required: boolean; canSet: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const when = at ? new Date(at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" }) : "";
  const pick = async (v: boolean) => {
    if (v === on) return;
    setBusy(true);
    setError(null);
    const r = await setTechClaimPartReceived(claimId, v);
    setBusy(false);
    if (r.error) setError(r.error);
    else router.refresh();
  };
  const btn = (active: boolean, tone: string) =>
    `rounded-md px-3 py-1 text-sm font-semibold disabled:opacity-50 ${active ? tone : "bg-white text-neutral-600 hover:bg-neutral-50"}`;
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-4 py-3 text-sm shadow-sm ring-1 ${on ? "bg-emerald-50 ring-emerald-200" : required ? "bg-amber-50 ring-amber-200" : "bg-white ring-neutral-200/70"}`}>
      <span className="font-semibold text-neutral-900">
        Defective part received?
        {required && <span className="ml-1.5 rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-900">Required for E7 before approval</span>}
      </span>
      {canSet ? (
        <span className="inline-flex gap-1 rounded-lg bg-neutral-100 p-1">
          <button type="button" disabled={busy} aria-pressed={on} onClick={() => void pick(true)} className={btn(on, "bg-emerald-600 text-white")}>
            Yes
          </button>
          <button type="button" disabled={busy} aria-pressed={!on} onClick={() => void pick(false)} className={btn(!on, "bg-neutral-700 text-white")}>
            No
          </button>
        </span>
      ) : (
        <span className={`font-semibold ${on ? "text-emerald-700" : "text-neutral-600"}`}>{on ? "Yes" : "No"}</span>
      )}
      {on && by && (
        <span className="text-xs text-neutral-500">
          {by} · {when}
        </span>
      )}
      {error && <span className="w-full text-xs text-red-700">{error}</span>}
    </div>
  );
}
