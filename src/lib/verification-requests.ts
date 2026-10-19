import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Nav badge for the technical team / officers: how many verification code requests wait for a code. */
export async function openVerificationCount(): Promise<string | undefined> {
  try {
    const { count } = await createAdminClient().from("self_audit_verification_requests").select("id", { count: "exact", head: true }).eq("status", "open");
    return count ? String(count) : undefined;
  } catch {
    return undefined;
  }
}
