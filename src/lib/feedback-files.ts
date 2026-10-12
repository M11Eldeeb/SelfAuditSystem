import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { FEEDBACK_BUCKET } from "@/lib/feedback-constants";

export type FeedbackAttachmentView = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string | null;
};

type AttachmentRow = Database["public"]["Tables"]["self_audit_feedback_attachments"]["Row"];

/** Signs short-lived URLs for a feedback's attachments (the bucket is private). */
export async function signFeedbackAttachments(
  supabase: SupabaseClient<Database>,
  rows: AttachmentRow[]
): Promise<FeedbackAttachmentView[]> {
  if (rows.length === 0) return [];
  const { data } = await supabase.storage.from(FEEDBACK_BUCKET).createSignedUrls(
    rows.map((r) => r.storage_path),
    3600
  );
  const urlByPath = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
  return rows.map((r) => ({
    id: r.id,
    fileName: r.file_name,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    url: urlByPath.get(r.storage_path) ?? null,
  }));
}
