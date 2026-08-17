"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateTempPassword } from "@/lib/temp-password";

export type ActionState = { error?: string; success?: string; tempPassword?: string } | undefined;

export async function createBranch(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("officer");

  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim().toUpperCase();

  if (!name || !code) {
    return { error: "Branch name and code are required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("branches").insert({ name, code });

  if (error) {
    return { error: error.message.includes("duplicate") ? "That branch code is already in use." : error.message };
  }

  revalidatePath("/admin/branches");
  return { success: `Branch "${name}" created.` };
}

export async function createUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("officer");

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const role = String(formData.get("role") ?? "");
  const branchId = String(formData.get("branch_id") ?? "");

  if (!email || (role !== "officer" && role !== "branch_admin")) {
    return { error: "Email and a valid role are required." };
  }
  if (role === "branch_admin" && !branchId) {
    return { error: "Select a branch for a branch admin account." };
  }

  const tempPassword = generateTempPassword();
  const admin = createAdminClient();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  });

  if (createError || !created.user) {
    return { error: createError?.message ?? "Could not create the account." };
  }

  const supabase = await createClient();
  const { error: profileError } = await supabase.from("users").insert({
    id: created.user.id,
    email,
    full_name: fullName || null,
    role,
    branch_id: role === "branch_admin" ? branchId : null,
  });

  if (profileError) {
    // Roll back the auth user so we don't leave an orphaned login with no profile.
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: profileError.message };
  }

  revalidatePath("/admin/branches");
  return {
    success: `Account created for ${email}.`,
    tempPassword,
  };
}

export async function resetUserPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("officer");

  const userId = String(formData.get("user_id") ?? "");
  const email = String(formData.get("email") ?? "");
  if (!userId) return { error: "Missing user." };

  const tempPassword = generateTempPassword();
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { password: tempPassword });

  if (error) {
    return { error: error.message };
  }

  return { success: `Password reset for ${email}.`, tempPassword };
}
