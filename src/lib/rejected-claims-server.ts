import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { CurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { REJECTED_BUCKET, REJECTED_CLAIMS_FLAG } from "@/lib/rejected-claims";
import type { FeedbackAttachmentView } from "@/lib/feedback-files";

type AttachmentRow = Database["public"]["Tables"]["self_audit_rejected_claim_attachments"]["Row"];

/**
 * Can this user use the diary? Officers always can. Branch admins only once the
 * 'rejected_claims_branch_admins' flag is switched on - until then they see a
 * "coming soon" page (the database refuses their reads and writes too).
 */
export async function getRejectedClaimsAccess(user: CurrentUser): Promise<"full" | "locked" | "none"> {
  if (user.role === "officer") return "full";
  if (user.role !== "branch_admin") return "none";
  const supabase = await createClient();
  const { data } = await supabase.rpc("feature_enabled", { p_key: REJECTED_CLAIMS_FLAG });
  return data === true ? "full" : "locked";
}

/** Short-lived links for the files (the bucket is private). Drive-stored files link to Drive. */
export async function signRejectedAttachments(
  supabase: SupabaseClient<Database>,
  rows: AttachmentRow[]
): Promise<(FeedbackAttachmentView & { commentId: string | null })[]> {
  const paths = rows.flatMap((r) => (r.storage === "supabase" && r.storage_path ? [r.storage_path] : []));
  const urlByPath = new Map<string, string>();
  if (paths.length > 0) {
    const { data } = await supabase.storage.from(REJECTED_BUCKET).createSignedUrls(paths, 3600);
    (data ?? []).forEach((d) => {
      if (d.path && d.signedUrl) urlByPath.set(d.path, d.signedUrl);
    });
  }
  return rows.map((r) => ({
    id: r.id,
    commentId: r.comment_id,
    fileName: r.file_name,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    // Drive files are served through the site (which checks access); older Supabase files via a signed link.
    url: r.storage === "drive" ? `/api/rejected-claims/files/${r.id}` : (urlByPath.get(r.storage_path ?? "") ?? null),
  }));
}
