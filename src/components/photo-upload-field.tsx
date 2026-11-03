"use client";

import { useState } from "react";
import { prepareSelfAuditDocUpload, type DocTarget } from "@/app/actions/self-audit-docs";
import { uploadToSession } from "@/components/tech-claims/upload";
import type { PhotoStatus } from "@/lib/photo-status";

/**
 * Uploads directly from the browser to Google Drive (Self Audit Documents / month / branch / claim): the server only
 * opens the upload session; the bytes go browser -> Google. Only the resulting "drive:<id>.<ext>" goes through the
 * form submission.
 */
export function PhotoUploadField({
  label,
  helpText,
  required,
  locked,
  target,
  photoTypeId,
  status,
  fieldName,
}: {
  label: string;
  helpText: string | null;
  required: boolean;
  locked: boolean;
  target: DocTarget;
  photoTypeId: string;
  status: PhotoStatus | undefined;
  fieldName: string;
}) {
  const [phase, setPhase] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const [pct, setPct] = useState(0);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setPhase("uploading");
    setError(null);
    setPct(0);
    const prep = await prepareSelfAuditDocUpload(target, photoTypeId, { name: file.name, type: file.type, size: file.size });
    if (prep.error || !prep.session) {
      setPhase("error");
      setError(prep.error ?? "Could not start the upload.");
      return;
    }
    try {
      const id = await uploadToSession(prep.session, file, (sent) => setPct(Math.round((sent / Math.max(1, file.size)) * 100)));
      const ext = (file.name.split(".").pop() || (file.type === "application/pdf" ? "pdf" : "jpg")).toLowerCase();
      setUploadedPath(`drive:${id}.${ext}`);
      setPhase("done");
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "The upload failed.");
    }
  }

  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-neutral-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {helpText && <p className="text-xs text-neutral-500">{helpText}</p>}
      {status && "url" in status && (
        <a
          href={status.url}
          target="_blank"
          rel="noreferrer"
          className="block text-xs text-brand underline"
        >
          View current photo
        </a>
      )}
      {status && "removed" in status && (
        <p className="text-xs text-neutral-400">Photo removed after review to save storage.</p>
      )}
      {!locked && (
        <>
          <input
            type="file"
            accept="image/*,application/pdf"
            disabled={phase === "uploading"}
            onChange={handleChange}
            className="block w-full text-sm text-neutral-700 file:mr-3 file:rounded-md file:border file:border-neutral-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-neutral-700 file:shadow-sm hover:file:bg-neutral-50"
          />
          {phase === "uploading" && <p className="text-xs text-neutral-500">Uploading {pct}%…</p>}
          {phase === "done" && <p className="text-xs text-green-600">Uploaded.</p>}
          {phase === "error" && <p className="text-xs text-red-600">Upload failed: {error}</p>}
          {uploadedPath && <input type="hidden" name={fieldName} value={uploadedPath} />}
        </>
      )}
    </div>
  );
}
