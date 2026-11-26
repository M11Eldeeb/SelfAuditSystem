"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getQcDetail } from "@/lib/qc/server";
import { canCommentOnQc } from "@/lib/qc/supervisor";

/** A comment on a QC report, by the quality supervisor or a warranty officer; everyone who sees the QC reads it. */
export async function addQcComment(checkId: string, body: string): Promise<{ error?: string }> {
  const user = await getCurrentUser();
  if (!user || user.must_change_password) return { error: "Not signed in." };
  if (!canCommentOnQc(user)) return { error: "You cannot comment on QC reports." };
  const text = body.trim();
  if (!text) return { error: "Write the comment first." };
  if (text.length > 4000) return { error: "The comment is too long (4000 characters at most)." };
  const qc = await getQcDetail(user, checkId);
  if (!qc) return { error: "QC report not found." };
  const { error } = await createAdminClient()
    .from("self_audit_qc_comments")
    .insert({ check_id: qc.id, author_id: user.id, author_name: user.full_name?.trim() || user.email, author_role: user.role, body: text });
  if (error) return { error: "The comment could not be saved. Try again." };
  for (const base of ["/qs/reports", "/admin/quality-control", "/audit/quality-control", "/workshop/quality-control", "/qc"]) revalidatePath(`${base}/${qc.id}`);
  return {};
}
