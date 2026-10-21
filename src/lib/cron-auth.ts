import "server-only";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Who may call the /api/cron routes: the database scheduler (pg_cron), which sends the secret kept in
 * self_audit_cron_secret, or anyone holding Vercel's own CRON_SECRET (when it is set). The schedule lives in the
 * database because Vercel's free plan only promises "sometime in the hour".
 */
export async function isCronAuthorized(request: Request): Promise<boolean> {
  const header = request.headers.get("authorization") ?? "";
  const envSecret = process.env.CRON_SECRET;
  if (envSecret && same(header, `Bearer ${envSecret}`)) return true;
  const { data } = await createAdminClient().from("self_audit_cron_secret").select("secret").eq("id", 1).maybeSingle();
  return !!data?.secret && same(header, `Bearer ${data.secret}`);
}
