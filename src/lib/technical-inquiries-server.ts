import "server-only";
import type { CurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { INQUIRIES_FLAG, type InquiryRole } from "@/lib/technical-inquiries";

/** The role as far as Technical Inquiries is concerned, or null for roles with no access (finance). */
export function inquiryRole(user: CurrentUser): InquiryRole | null {
  return user.role === "officer" || user.role === "technical" || user.role === "branch_admin" ? user.role : null;
}

/**
 * Can this user use Technical Inquiries? Officers and the technical team always can. Branch admins only once the
 * 'technical_inquiries_branch_admins' flag is switched on - until then they see "coming soon" (the database
 * refuses their reads and writes too).
 */
export async function getInquiriesAccess(user: CurrentUser): Promise<"full" | "locked" | "none"> {
  if (user.role === "officer" || user.role === "technical") return "full";
  if (user.role !== "branch_admin") return "none";
  const supabase = await createClient();
  const { data } = await supabase.rpc("feature_enabled", { p_key: INQUIRIES_FLAG });
  return data === true ? "full" : "locked";
}

/**
 * The small tag on the navigation tab: how many inquiries wait for THIS role to act - the technical team and officers:
 * new or answered by the workshop; branch admins: waiting for their reply ("Soon" while locked).
 */
export async function inquiriesBadge(user: CurrentUser): Promise<string | undefined> {
  try {
    const access = await getInquiriesAccess(user);
    if (access === "locked") return "Soon";
    if (access !== "full") return undefined;
    const status = user.role === "branch_admin" ? "awaiting_workshop" : "open";
    const supabase = await createClient();
    const { count } = await supabase.from("self_audit_technical_inquiries").select("id", { count: "exact", head: true }).eq("status", status);
    return count && count > 0 ? String(count) : undefined;
  } catch {
    return undefined; // a slow or failing count must never break a page
  }
}
