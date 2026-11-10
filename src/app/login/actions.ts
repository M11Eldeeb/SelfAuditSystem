"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { homePathFor } from "@/lib/auth";

export type LoginState = { error?: string } | undefined;

// Brute-force limit: Supabase only sees our server's address, so the site counts failed sign-ins itself -
// at most 5 per account and 30 per network address in 15 minutes.
const WINDOW_MS = 15 * 60_000;
const MAX_PER_ACCOUNT = 5;
const MAX_PER_ADDRESS = 30;
const TOO_MANY = "Too many failed sign-ins. Wait 15 minutes and try again.";

async function failures(keys: string[]): Promise<number[]> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  return Promise.all(
    keys.map(async (key) => {
      const { count, error } = await admin.from("self_audit_login_failures").select("id", { count: "exact", head: true }).eq("key", key).gte("at", since);
      return error ? 0 : (count ?? 0); // the limit never locks anyone out because of its own error
    }),
  );
}

async function recordFailure(keys: string[]) {
  const admin = createAdminClient();
  await admin.from("self_audit_login_failures").insert(keys.map((key) => ({ key })));
  // Old rows are not needed: drop everything older than a day.
  await admin.from("self_audit_login_failures").delete().lt("at", new Date(Date.now() - 86_400_000).toISOString());
}

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const login = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!login || !password) {
    return { error: "Enter your email and password." };
  }

  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
  const keys = [`acct:${login.toLowerCase()}`, `ip:${ip}`];
  const [byAccount, byAddress] = await failures(keys);
  if (byAccount >= MAX_PER_ACCOUNT || byAddress >= MAX_PER_ADDRESS) return { error: TOO_MANY };

  // Technicians may sign in with their employee number instead of an e-mail.
  let email = login;
  if (!login.includes("@")) {
    const { data: byNo } = await createAdminClient().from("self_audit_users").select("email").ilike("employee_no", login.replace(/[%_\\]/g, "\\$&")).limit(1).maybeSingle();
    if (!byNo) {
      await recordFailure(keys).catch(() => undefined);
      return { error: "Invalid email or password." };
    }
    email = byNo.email;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    await recordFailure(keys).catch(() => undefined);
    return { error: "Invalid email or password." };
  }
  await createAdminClient().from("self_audit_login_failures").delete().eq("key", keys[0]);

  const { data: profile } = await supabase
    .from("self_audit_users")
    .select("role")
    .eq("id", data.user.id)
    .single();

  redirect(homePathFor(profile?.role));
}
