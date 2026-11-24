"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateTempPassword } from "@/lib/temp-password";
import { compareUsers } from "@/lib/user-roles";
import { getsCourtesyWelcome, sendCourtesyWelcome, signedInIds, welcomeSentMap } from "@/lib/courtesy/welcome-mail";
import { siteOrigin } from "@/lib/site-origin";

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
  const me = await requireRole("officer");

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const role = String(formData.get("role") ?? "");
  const branchId = String(formData.get("branch_id") ?? "");
  const queueRole = (["advisor", "parts_advisor", "manager"] as const).find((r) => r === formData.get("queue_role")) ?? null;
  if (role === "queue_user" && !queueRole) return { error: "Choose what this person does in the customer queue." };

  const WORKSHOP_ROLES = ["branch_admin", "workshop_supervisor", "team_leader", "service_manager", "technician", "claims_reviewer", "service_advisor", "quality_controller"];
  if (!email || (role !== "officer" && role !== "manager" && role !== "national_manager" && role !== "data_analyst" && role !== "technical" && role !== "queue_user" && !WORKSHOP_ROLES.includes(role))) {
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
    role: role as "officer" | "manager" | "national_manager" | "data_analyst" | "branch_admin" | "technical" | "workshop_supervisor" | "team_leader" | "service_manager" | "technician" | "claims_reviewer" | "service_advisor" | "quality_controller" | "queue_user",
    // A queue-only account may have no branch (head office queue manager / parts staff).
    branch_id: WORKSHOP_ROLES.includes(role) || (role === "queue_user" && branchId) ? branchId : null,
    queue_role: queueRole,
  });

  if (profileError) {
    // Roll back the auth user so we don't leave an orphaned login with no profile.
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: profileError.message };
  }

  // Service advisors and the reception team get the welcome e-mail (sign-in and the Courtesy Cars guide) at once, and
  // choose their own password at the first sign-in.
  let mailNote = "";
  if (getsCourtesyWelcome(role, queueRole)) {
    await admin.from("self_audit_users").update({ must_change_password: true }).eq("id", created.user.id);
    const sent = await sendCourtesyWelcome({
      name: fullName || email.split("@")[0],
      email,
      tempPassword,
      receptionManager: role === "queue_user" && queueRole === "manager",
      senderName: me.full_name?.trim() || "Warranty Team",
      site: await siteOrigin(),
      sentBy: me.id,
    }).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Could not send." }));
    mailNote = sent.ok ? " Welcome e-mail sent." : ` The welcome e-mail could not be sent (${sent.error}) - give the password by hand.`;
  }

  revalidatePath("/admin/branches");
  return {
    success: `Account created for ${email}.${mailNote}`,
    tempPassword,
  };
}

type WelcomeUser = { id: string; email: string; full_name: string | null; role: string; queue_role: string | null };

/** A new temporary password (chosen again at the next sign-in), sent in the welcome e-mail with the Courtesy Cars guide. */
async function welcomeOne(u: WelcomeUser, me: { id: string; full_name: string | null }, site: string) {
  const admin = createAdminClient();
  const tempPassword = generateTempPassword();
  const { error } = await admin.auth.admin.updateUserById(u.id, { password: tempPassword });
  if (error) return { ok: false as const, error: error.message };
  await admin.from("self_audit_users").update({ must_change_password: true }).eq("id", u.id);
  const sent = await sendCourtesyWelcome({
    name: u.full_name?.trim() || u.email.split("@")[0],
    email: u.email,
    tempPassword,
    receptionManager: u.role === "queue_user" && u.queue_role === "manager",
    senderName: me.full_name?.trim() || "Warranty Team",
    site,
    sentBy: me.id,
  }).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Could not send." }));
  return sent.ok ? { ok: true as const } : { ok: false as const, error: sent.error, tempPassword };
}

/**
 * The welcome e-mail for an account made before it existed (or whose e-mail failed): once per account. A new temporary
 * password is set and sent in it. Service advisors and the reception team only.
 */
export async function sendWelcomeEmail(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireRole("officer");
  if (me.viewOnly) return { error: "View only." };
  const userId = String(formData.get("user_id") ?? "");
  if (!userId) return { error: "Missing user." };
  const { data: u } = await createAdminClient().from("self_audit_users").select("id, email, full_name, role, queue_role").eq("id", userId).maybeSingle();
  if (!u) return { error: "Account not found." };
  if (!getsCourtesyWelcome(u.role, u.queue_role)) return { error: "Only for service advisors and the reception team." };
  if ((await welcomeSentMap()).has(u.email.toLowerCase())) return { error: "The welcome e-mail was already sent to this account." };
  const r = await welcomeOne(u, me, await siteOrigin());
  revalidatePath("/admin/branches");
  if (!r.ok) return { error: `The password was changed but the e-mail could not be sent (${r.error}).`, tempPassword: r.tempPassword };
  return { success: `Welcome e-mail sent to ${u.email}.` };
}

/**
 * The welcome e-mail to every new service advisor / reception account at once: those that never got it and never signed
 * in (someone already using the portal keeps his password). 15 per click (time limit), the rest with the next click.
 */
export async function sendWelcomeToAllNew(): Promise<{ sent: string[]; failed: { email: string; error: string; tempPassword?: string }[]; left: number; error?: string }> {
  const me = await requireRole("officer");
  if (me.viewOnly) return { sent: [], failed: [], left: 0, error: "View only." };
  const [{ data: users }, sentMap, signedIn] = await Promise.all([
    createAdminClient().from("self_audit_users").select("id, email, full_name, role, queue_role"),
    welcomeSentMap(),
    signedInIds(),
  ]);
  const todo = (users ?? []).filter((u) => getsCourtesyWelcome(u.role, u.queue_role) && !sentMap.has(u.email.toLowerCase()) && !signedIn.has(u.id));
  const site = await siteOrigin();
  const sent: string[] = [];
  const failed: { email: string; error: string; tempPassword?: string }[] = [];
  for (const u of todo.slice(0, 15)) {
    const r = await welcomeOne(u, me, site);
    if (r.ok) sent.push(u.email);
    else failed.push({ email: u.email, error: r.error, tempPassword: r.tempPassword });
  }
  revalidatePath("/admin/branches");
  return { sent, failed, left: Math.max(0, todo.length - 15) };
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

export type UserExportRow = {
  name: string;
  login: string;
  email: string;
  employeeNo: string;
  role: string;
  branch: string;
  viewAll: boolean;
  mustChangePassword: boolean;
  createdAt: string | null;
  lastSignIn: string | null;
};

const ROLE_NAMES: Record<string, string> = {
  officer: "Warranty officer",
  branch_admin: "Warranty admin (branch)",
  national_manager: "National Manager (view only, all branches)",
  manager: "Manager (view only, all branches)",
  data_analyst: "Data Analyst (Sub-Dealer Analytics only)",
  service_manager: "Service manager (view only, own branch)",
  claims_reviewer: "Technician claims reviewer",
  technical: "Technical team",
  workshop_supervisor: "Workshop supervisor",
  team_leader: "Team leader",
  service_advisor: "Service advisor",
  queue_user: "Queue only",
  quality_controller: "Quality controller",
  technician: "Technician",
};

/** Officers only: every portal user for the Excel download - with the last sign-in time, never a password. */
export async function exportUsers(): Promise<{ rows?: UserExportRow[]; error?: string }> {
  await requireRole("officer");
  const admin = createAdminClient();
  const [{ data: users, error }, { data: branches }] = await Promise.all([
    admin.from("self_audit_users").select("id, email, full_name, role, branch_id, employee_no, view_all, must_change_password, created_at").order("role").order("full_name"),
    admin.from("self_audit_branches").select("id, name"),
  ]);
  if (error) return { error: error.message };
  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const ordered = [...(users ?? [])].sort((a, b) =>
    compareUsers({ ...a, branchName: a.branch_id ? branchName.get(a.branch_id) : null }, { ...b, branchName: b.branch_id ? branchName.get(b.branch_id) : null })
  );

  // Last sign-in comes from the sign-in service (1,000 accounts per page).
  const lastSignIn = new Map<string, string | null>();
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    for (const u of data?.users ?? []) lastSignIn.set(u.id, u.last_sign_in_at ?? null);
    if (!data?.users || data.users.length < 1000) break;
  }

  const synthetic = (email: string) => email.endsWith("@technicians.jiadmotors.local");
  return {
    rows: ordered.map((u) => ({
      name: u.full_name ?? "",
      login: u.employee_no && synthetic(u.email) ? u.employee_no : u.email,
      email: synthetic(u.email) ? "" : u.email,
      employeeNo: u.employee_no ?? "",
      role: ROLE_NAMES[u.role] ?? u.role,
      branch: u.branch_id ? (branchName.get(u.branch_id) ?? "") : "",
      viewAll: !!u.view_all,
      mustChangePassword: !!u.must_change_password,
      createdAt: u.created_at,
      lastSignIn: lastSignIn.get(u.id) ?? null,
    })),
  };
}
