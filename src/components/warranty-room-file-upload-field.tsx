"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Same direct browser-to-Storage upload pattern as PhotoUploadField (see
 * that file for why: Vercel's 4.5MB serverless request-body cap), targeting
 * the "warranty-room-files" bucket instead of "audit-photos" - shared by the
 * scrap-destruction video and the supplier hand-over's signed PDF/video.
 */
export function WarrantyRoomFileUploadField({
  label,
  helpText,
  accept,
  required,
  buildPath,
  fieldName,
  currentUrl,
}: {
  label: string;
  helpText?: string;
  accept: string;
  required?: boolean;
  buildPath: (ext: string) => string;
  fieldName: string;
  currentUrl?: string | null;
}) {
  const [phase, setPhase] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setPhase("uploading");
    setError(null);

    const ext = file.name.split(".").pop() || "bin";
    const path = buildPath(ext);
    const supabase = createClient();
    const { error: uploadError } = await supabase.storage
      .from("warranty-room-files")
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
      {currentUrl && (
        <a href={currentUrl} target="_blank" rel="noreferrer" className="block text-xs text-brand underline">
          View current file
        </a>
      )}
      <input
        type="file"
        accept={accept}
        disabled={phase === "uploading"}
        onChange={handleChange}
        className="block w-full text-sm text-neutral-700 file:mr-3 file:rounded-md file:border file:border-neutral-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-neutral-700 file:shadow-sm hover:file:bg-neutral-50"
      />
      {phase === "uploading" && <p className="text-xs text-neutral-500">Uploading…</p>}
      {phase === "done" && <p className="text-xs text-green-600">Uploaded.</p>}
      {phase === "error" && <p className="text-xs text-red-600">Upload failed: {error}</p>}
      {uploadedPath && <input type="hidden" name={fieldName} value={uploadedPath} />}
    </div>
  );
}
