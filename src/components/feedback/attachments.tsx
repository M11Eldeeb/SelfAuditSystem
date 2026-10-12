import { formatBytes } from "@/lib/feedback-constants";
import type { FeedbackAttachmentView } from "@/lib/feedback-files";

/** Photos and videos play inline; PDFs open in a new tab. Always offers a link to the file. */
export function FeedbackAttachments({ attachments }: { attachments: FeedbackAttachmentView[] }) {
  if (attachments.length === 0) return null;
  return (
    <ul className="space-y-3">
      {attachments.map((a) => (
        <li key={a.id} className="space-y-1.5">
          {a.url && a.mimeType.startsWith("image/") && (
            <a href={a.url} target="_blank" rel="noreferrer" className="block w-fit">
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimizable */}
              <img
                src={a.url}
                alt={a.fileName}
                className="max-h-72 max-w-full rounded-lg border border-neutral-200 object-contain"
              />
            </a>
          )}
          {a.url && a.mimeType.startsWith("video/") && (
            <video src={a.url} controls preload="metadata" className="max-h-80 max-w-full rounded-lg border border-neutral-200 bg-black" />
          )}
          <p className="text-xs text-neutral-500">
            {a.url ? (
              <a href={a.url} target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">
                {a.fileName}
              </a>
            ) : (
              a.fileName
            )}{" "}
            · {formatBytes(a.sizeBytes)}
            {a.mimeType === "application/pdf" && a.url ? " · PDF" : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}
