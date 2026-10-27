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
  const { error } = await supabase.from("self_audit_branches").insert({ name, code });

  if (error) {
    return { error: error.message.includes("duplicate") ? "That branch code is already in use." : error.message };
  }

  revalidatePath("/admin/branches");
  return { success: `Branch "${name}" created.` };
}

export async function updateBranch(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("officer");

  const branchId = String(formData.get("branch_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim().toUpperCase();

  if (!branchId) return { error: "Missing branch." };
  if (!name || !code) {
    return { error: "Branch name and code are required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("self_audit_branches").update({ name, code }).eq("id", branchId);

  if (error) {
    return { error: error.message.includes("duplicate") ? "That branch code is already in use." : error.message };
  }

  revalidatePath("/admin/branches");
  return { success: `Branch "${name}" updated.` };
}

/**
 * Closing a branch mid-cycle removes it from any audit cycle it's still
 * sitting in - but only the parts of that cycle nobody has touched yet
 * (assignments/branch-ops still "not_started"). Anything already
 * in_progress, submitted, or reviewed is real work and is left alone
 * regardless of the branch's active flag, matching the standing rule that
 * only untouched/future cycle state is safe to change automatically.
 */
export async function setBranchActive(branchId: string, active: boolean): Promise<{ error?: string; removedAssignments?: number }> {
  await requireRole("officer");

  const supabase = await createClient();
  const { error } = await supabase.from("self_audit_branches").update({ active }).eq("id", branchId);
  if (error) return { error: error.message };

  let removedAssignments = 0;
  if (!active) {
    const [assignmentsResult, opsResult] = await Promise.all([
      supabase
        .from("self_audit_audit_assignments")
        .delete({ count: "exact" })
        .eq("branch_id", branchId)
        .eq("status", "not_started"),
      supabase
        .from("self_audit_branch_operation_progress")
        .delete()
        .eq("branch_id", branchId)
        .eq("status", "not_started"),
    ]);
    if (assignmentsResult.error) return { error: assignmentsResult.error.message };
    if (opsResult.error) return { error: opsResult.error.message };
    removedAssignments = assignmentsResult.count ?? 0;
  }

  revalidatePath("/admin/branches");
  return { removedAssignments };
}

export async function createUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("officer");

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const role = String(formData.get("role") ?? "");
  const branchId = String(formData.get("branch_id") ?? "");

  const WORKSHOP_ROLES = ["branch_admin", "workshop_supervisor", "team_leader", "service_manager", "technician"];
  if (!email || (role !== "officer" && role !== "finance" && role !== "technical" && !WORKSHOP_ROLES.includes(role))) {
    return { error: "Email and a valid role are required." };
  }
  if (WORKSHOP_ROLES.includes(role) && !branchId) {
    return { error: "Select a branch for this account." };
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
  const { error: profileError } = await supabase.from("self_audit_users").insert({
    id: created.user.id,
    email,
    full_name: fullName || null,
    role: role as "officer" | "branch_admin" | "finance" | "technical" | "workshop_supervisor" | "team_leader" | "service_manager" | "technician",
    branch_id: WORKSHOP_ROLES.includes(role) ? branchId : null,
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

export async function deleteBranch(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole("officer");

  const branchId = String(formData.get("branch_id") ?? "");
  const name = String(formData.get("name") ?? "this branch");
  if (!branchId) return { error: "Missing branch." };

  const supabase = await createClient();
  const { error } = await supabase.from("self_audit_branches").delete().eq("id", branchId);

  if (error) {
    // 23503 = the branch row itself is still referenced elsewhere (claims, cycles...).
    // 23514 = deleting it would null out a branch_admin's branch_id, which a check
    // constraint on `users` forbids - i.e. a branch admin account still points here.
    if (error.code === "23503" || error.code === "23514") {
      return {
        error: `Can't delete "${name}" - it still has claims, a branch admin account, or audit history attached to it. Move or delete those first.`,
      };
    }
    return { error: error.message };
  }

  revalidatePath("/admin/branches");
  return { success: `Branch "${name}" deleted.` };
}

export async function deleteUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const officer = await requireRole("officer");

  const userId = String(formData.get("user_id") ?? "");
  const email = String(formData.get("email") ?? "this account");
  if (!userId) return { error: "Missing user." };

  if (userId === officer.id) {
    return { error: "You can't delete your own account." };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);

  if (error) {
    if (error.message?.toLowerCase().includes("foreign key") || (error as { code?: string }).code === "23503") {
      return {
        error: `Can't delete ${email} - they have uploads, submissions, or reviews on record. Reset their password instead if you need to revoke access.`,
      };
    }
    return { error: error.message };
  }

  revalidatePath("/admin/branches");
  return { success: `${email} deleted.` };
}

export type TechnicianRow = { name: string; employeeNo: string; branch: string; email: string };
export type TechnicianResult = { row: number; name: string; employeeNo: string; branch: string; login: string; tempPassword?: string; error?: string };

/** Technicians without a company e-mail get this sign-in address (never mailed); they sign in with the employee number. */
const technicianEmail = (employeeNo: string) => `${employeeNo.toLowerCase().replace(/[^a-z0-9._-]/g, "")}@technicians.jiadmotors.local`;

/**
 * Creates technician accounts from the imported list (the page sends it 25 rows at a time). The branch is matched by
 * name or code. A row whose employee number or e-mail already has an account is skipped and reported.
 */
export async function importTechnicians(rows: (TechnicianRow & { row: number })[], sharedPassword = ""): Promise<{ results: TechnicianResult[]; error?: string }> {
  await requireRole("officer");
  if (rows.length > 50) return { results: [], error: "Send at most 50 rows at a time." };
  if (sharedPassword && sharedPassword.length < 8) return { results: [], error: "The shared password must have at least 8 characters." };
  const admin = createAdminClient();
  const [{ data: branches }, { data: existing }] = await Promise.all([
    admin.from("self_audit_branches").select("id, name, code"),
    admin.from("self_audit_users").select("email, employee_no"),
  ]);
  const branchOf = new Map<string, string>();
  for (const b of branches ?? []) {
    branchOf.set(b.name.trim().toLowerCase(), b.id);
    branchOf.set(b.code.trim().toLowerCase(), b.id);
  }
  const takenEmails = new Set((existing ?? []).map((u) => u.email.toLowerCase()));
  const takenNos = new Set((existing ?? []).map((u) => u.employee_no?.toLowerCase()).filter(Boolean));

  const one = async (r: TechnicianRow & { row: number }): Promise<TechnicianResult> => {
    const name = r.name.trim();
    const employeeNo = r.employeeNo.trim();
    const base = { row: r.row, name, employeeNo, branch: r.branch.trim(), login: "" };
    const branchId = branchOf.get(r.branch.trim().toLowerCase());
    if (!name) return { ...base, error: "Name is missing." };
    if (!employeeNo) return { ...base, error: "Employee number is missing." };
    if (!/^[A-Za-z0-9._-]{1,30}$/.test(employeeNo)) return { ...base, error: "Employee number: letters, digits, . _ - only." };
    if (!branchId) return { ...base, error: `Branch "${r.branch}" not found.` };
    const email = (r.email.trim().toLowerCase() || technicianEmail(employeeNo));
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ...base, error: "E-mail is not valid." };
    if (takenNos.has(employeeNo.toLowerCase())) return { ...base, login: employeeNo, error: "Already has an account." };
    if (takenEmails.has(email)) return { ...base, login: email, error: "This e-mail already has an account." };
    takenNos.add(employeeNo.toLowerCase());
    takenEmails.add(email);

    // One password for the whole list when the officer gave one, else a temporary one each. Either way the
    // technician chooses his own at the first sign-in.
    const tempPassword = sharedPassword || generateTempPassword();
    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password: tempPassword, email_confirm: true });
    if (createError || !created.user) return { ...base, error: createError?.message ?? "Could not create the account." };
    const { error } = await admin.from("self_audit_users").insert({ id: created.user.id, email, full_name: name, role: "technician", branch_id: branchId, employee_no: employeeNo, must_change_password: true });
    if (error) {
      await admin.auth.admin.deleteUser(created.user.id);
      return { ...base, error: error.message };
    }
    return { ...base, login: employeeNo, tempPassword: sharedPassword ? "(the shared password)" : tempPassword };
  };

  const results: TechnicianResult[] = [];
  for (let i = 0; i < rows.length; i += 5) results.push(...(await Promise.all(rows.slice(i, i + 5).map(one))));
  revalidatePath("/admin/branches");
  return { results };
}
