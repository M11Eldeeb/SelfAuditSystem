"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { branchTechnicians, prepareAdminClaimUploads, reassignTechClaim, registerAdminClaimFiles } from "@/app/actions/tech-claims";
import { uploadToSession } from "./upload";
import { Glyph } from "@/components/ui/glyph";

/** Warranty admin: add photos / videos / PDFs to a claim the technician already sent (straight into its Drive folder). */
export function AdminAddFiles({ claimId }: { claimId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function add(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setMsg(null);
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
      setMsg({ ok: true, text: `${reg.added} file${reg.added === 1 ? "" : "s"} added.` });
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
