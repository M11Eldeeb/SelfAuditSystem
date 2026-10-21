"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { homePathFor } from "@/lib/auth";

export type LoginState = { error?: string } | undefined;

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const login = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!login || !password) {
    return { error: "Enter your email and password." };
  }

  // Technicians may sign in with their employee number instead of an e-mail.
  let email = login;
  if (!login.includes("@")) {
    const { data: byNo } = await createAdminClient().from("self_audit_users").select("email").ilike("employee_no", login.replace(/[%_\\]/g, "\\$&")).limit(1).maybeSingle();
    if (!byNo) return { error: "Invalid email or password." };
    email = byNo.email;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return { error: "Invalid email or password." };
  }

  const { data: profile } = await supabase
    .from("self_audit_users")
    .select("role")
    .eq("id", data.user.id)
    .single();

  redirect(homePathFor(profile?.role));
}
