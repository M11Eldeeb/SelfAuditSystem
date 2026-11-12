import "server-only";
import { createClient } from "@/lib/supabase/server";

/** The Feedback menu entry of the roles that write to the warranty team; the badge counts replies they have not read yet. */
export async function feedbackLink(userId: string, href: string, label = "Feedback") {
  let unread = 0;
  try {
    const supabase = await createClient();
    const { data: mine } = await supabase.from("self_audit_feedback").select("id").eq("sender_id", userId).limit(300);
    const ids = (mine ?? []).map((f) => f.id);
    if (ids.length) {
      const { count } = await supabase.from("self_audit_feedback_replies").select("id", { count: "exact", head: true }).in("feedback_id", ids).is("sender_seen_at", null);
      unread = count ?? 0;
    }
  } catch {
    // no badge
  }
  return { href, label, bottom: true, badge: unread ? `${unread} new` : undefined };
}
