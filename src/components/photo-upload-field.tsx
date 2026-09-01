"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PhotoStatus } from "@/lib/photo-status";

/**
 * Uploads directly from the browser to Supabase Storage instead of routing the
 * file through the Server Action - Vercel hard-caps a serverless function's
 * request body at 4.5MB regardless of Next's own bodySizeLimit config, which
 * silently killed the connection (a raw 413, no in-app error) for anything
 * bigger than a few compressed phone photos - a scanned PDF crossed that
 * easily. Only the resulting storage path (a few bytes) goes through the
 * form submission now.
 */
export function PhotoUploadField({
  label,
  helpText,
  required,
  locked,
  buildPath,
  status,
  fieldName,
}: {
  label: string;
  helpText: string | null;
  required: boolean;
  locked: boolean;
  buildPath: (ext: string) => string;
  status: PhotoStatus | undefined;
  fieldName: string;
}) {
  const [phase, setPhase] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setPhase("uploading");
    setError(null);

    const ext = file.name.split(".").pop() || "jpg";
    const path = buildPath(ext);
    const supabase = createClient();
    const { error: uploadError } = await supabase.storage
      .from("audit-photos")
      .upload(path, file, { upsert: true, contentType: file.type || undefined });

    if (uploadError) {
      setPhase("error");
      setError(uploadError.message);
      return;
    }

    setUploadedPath(path);
    setPhase("done");
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
          {phase === "uploading" && <p className="text-xs text-neutral-500">Uploading…</p>}
          {phase === "done" && <p className="text-xs text-green-600">Uploaded.</p>}
          {phase === "error" && <p className="text-xs text-red-600">Upload failed: {error}</p>}
          {uploadedPath && <input type="hidden" name={fieldName} value={uploadedPath} />}
        </>
      )}
    </div>
  );
}
