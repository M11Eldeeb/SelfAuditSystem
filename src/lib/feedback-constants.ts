/** Limits for feedback attachments. The bucket enforces the size and type server-side too. */
export const FEEDBACK_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const FEEDBACK_MAX_FILES = 3;
export const FEEDBACK_SUBJECT_MAX = 200;
export const FEEDBACK_BODY_MAX = 5000;
export const FEEDBACK_BUCKET = "feedback-files";

/** accept="" value for the file picker. */
export const FEEDBACK_ACCEPT = "image/*,application/pdf,video/*";

export function isAllowedFeedbackMime(mime: string): boolean {
  return mime.startsWith("image/") || mime.startsWith("video/") || mime === "application/pdf";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Keeps the original name readable but safe as a storage object key. */
export function safeStorageName(name: string): string {
  const cleaned = name.replace(/[^\w.\-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.slice(-80) || "file";
}
