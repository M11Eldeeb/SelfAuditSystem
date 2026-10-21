"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteInternalAuditFile,
  prepareInternalAuditUploads,
  saveInternalAuditFiles,
  uploadInternalAuditReportToDrive,
} from "@/app/actions/internal-audit-files";

export type AuditFile = {
  id: string;
  kind: "attachment" | "report";
  file_name: string;
  drive_url: string | null;
  size_bytes: number;
  created_at: string;
};

const ACCEPT = "image/*,video/*,application/pdf,.csv,.xlsx,.xls,.docx,.doc,.pptx,.ppt";
const fmtSize = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const fmtDate = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" });

/**
 * Internal audit files on the company Google Drive (Internal Audit / <branch> /
 * <MM-YYYY>): upload any number of photos / PDFs / sheets, open or remove them,
 * and - once finalized - the audit result PDF, which is saved automatically.
 */
export function InternalAuditFilesPanel({
  auditId,
  files,
  finalized,
  driveConnected,
  folderLabel,
}: {
  auditId: string;
  files: AuditFile[];
  finalized: boolean;
  driveConnected: boolean;
  folderLabel: string;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const report = files.find((f) => f.kind === "report");
  const attachments = files.filter((f) => f.kind === "attachment");

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    const picked = Array.from(list);
    setError(null);
    setBusy(true);
    try {
      setStatus("Preparing the Drive folder...");
      const prepared = await prepareInternalAuditUploads({
        auditId,
        files: picked.map((f) => ({ name: f.name, type: f.type || "application/octet-stream", size: f.size })),
      });
      if (prepared.error || !prepared.uploads) throw new Error(prepared.error ?? "Could not prepare the upload.");
      const ids: string[] = [];
      for (let i = 0; i < picked.length; i++) {
        setStatus(`Uploading ${i + 1} of ${picked.length}: ${picked[i].name}`);
        const res = await fetch(prepared.uploads[i].sessionUrl, { method: "PUT", headers: { "Content-Type": picked[i].type }, body: picked[i] });
        const json = (await res.json().catch(() => null)) as { id?: string } | null;
        if (!res.ok || !json?.id) throw new Error(`Google Drive did not accept "${picked[i].name}" (${res.status}).`);
        ids.push(json.id);
      }
      setStatus("Saving...");
      const saved = await saveInternalAuditFiles({ auditId, driveFileIds: ids });
      if (saved.error) throw new Error(saved.error);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed - please try again.");
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  async function remove(f: AuditFile) {
    if (!window.confirm(`Remove "${f.file_name}"? It goes to the Drive trash (recoverable for 30 days).`)) return;
    setBusy(true);
    const res = await deleteInternalAuditFile(f.id);
    setBusy(false);
    if (res.error) setError(res.error);
    else router.refresh();
  }

  async function uploadResult() {
    setError(null);
    setBusy(true);
    setStatus("Saving the result PDF to Drive...");
    const res = await uploadInternalAuditReportToDrive(auditId);
    setBusy(false);
    setStatus(null);
    if (res.error) setError(res.error);
    else router.refresh();
  }

  return (
    <section className="space-y-3 rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm print:hidden">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-neutral-900">Audit files on Google Drive</h2>
          <p className="text-xs text-neutral-500">Internal Audit / {folderLabel}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" multiple hidden accept={ACCEPT} onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
          <button
            type="button"
            disabled={busy || !driveConnected}
            onClick={() => input.current?.click()}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition hover:bg-brand-dark disabled:opacity-50"
          >
            ⬆ Upload files
          </button>
          {finalized && (
            <button
              type="button"
              disabled={busy || !driveConnected}
              onClick={uploadResult}
              className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-50 disabled:opacity-50"
            >
              {report ? "Re-upload result PDF" : "Upload result PDF"}
            </button>
          )}
        </div>
      </div>

      {!driveConnected && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Google Drive is not connected yet - connect it from the Rejected Claims From The Branch settings.</p>
      )}
      {status && <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">{status}</p>}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {finalized && (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm">
          <span className="font-medium text-emerald-900">📄 Audit result PDF</span>
          {report ? (
            <span className="flex items-center gap-3 text-xs text-emerald-800">
              saved {fmtDate(report.created_at)}
              {report.drive_url && (
                <a href={report.drive_url} target="_blank" rel="noreferrer" className="font-semibold underline">
                  Open in Drive
                </a>
              )}
            </span>
          ) : (
            <span className="text-xs text-emerald-800">not on Drive yet</span>
          )}
        </div>
      )}

      {attachments.length > 0 ? (
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-100">
          {attachments.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate" title={f.file_name}>
                {f.drive_url ? (
                  <a href={f.drive_url} target="_blank" rel="noreferrer" className="text-neutral-900 hover:text-brand hover:underline">
                    {f.file_name}
                  </a>
                ) : (
                  f.file_name
                )}
              </span>
              <span className="text-xs text-neutral-500">{fmtSize(f.size_bytes)}</span>
              <span className="hidden text-xs text-neutral-500 sm:inline">{fmtDate(f.created_at)}</span>
              <button type="button" disabled={busy} onClick={() => remove(f)} className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50">
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-neutral-500">No files uploaded yet.</p>
      )}
    </section>
  );
}
