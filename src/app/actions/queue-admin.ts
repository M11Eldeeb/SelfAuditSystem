"use server";

// Customer queue admin (warranty officers): each branch's queue code, Arabic name and status; who has queue access;
// creating the accounts of the queue people from the old app; the team list.

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getQueueAccess } from "@/lib/queue/server";
import type { QueueRole } from "@/lib/supabase/types";

const ROLES: QueueRole[] = ["advisor", "parts_advisor", "manager"];

async function officer() {
  const a = await getQueueAccess();
  if (!a?.admin || a.user.viewOnly) throw new Error("Only the warranty officers manage the queue.");
  return a;
}

export async function updateBranchQueue(branchId: string, input: { queueCode: string; nameAr: string; status: string }): Promise<{ error?: string }> {
  await officer();
  const code = input.queueCode.trim().toUpperCase();
  if (code && !/^[A-Z0-9-]{2,30}$/.test(code)) return { error: "Queue code: letters, digits and - only (2 to 30)." };
  const status = (["open", "paused", "closed"] as const).find((s) => s === input.status) ?? "open";
  const { error } = await createAdminClient()
    .from("self_audit_branches")
    .update({ queue_code: code || null, name_ar: input.nameAr.trim().slice(0, 80) || null, queue_status: status })
    .eq("id", branchId);
  if (error) return { error: error.code === "23505" ? "Another branch has this queue code." : error.message };
  revalidatePath("/queue", "layout");
  return {};
}

/** Queue access of one account (null removes it). A queue-only account must keep a queue role. */
export async function setQueueRole(userId: string, role: string | null, jobTitle: string): Promise<{ error?: string }> {
  await officer();
  const queueRole = ROLES.find((r) => r === role) ?? null;
  const admin = createAdminClient();
  const { data: u } = await admin.from("self_audit_users").select("role").eq("id", userId).maybeSingle();
  if (!u) return { error: "Account not found." };
  if (u.role === "queue_user" && !queueRole) return { error: "This account is for the queue only - delete it on the Users page instead." };
  const { error } = await admin.from("self_audit_users").update({ queue_role: queueRole, job_title: jobTitle.trim().slice(0, 80) || null }).eq("id", userId);
  if (error) return { error: error.message };
  revalidatePath("/queue", "layout");
  return {};
}

export type ImportResult = { employeeId: string; name: string; email: string; outcome: "created" | "linked" | "error"; message?: string };

/**
 * The queue people from the old app (the team list rows with a queue role): someone who already has a portal account
 * (same e-mail) gets queue access on it; anyone else gets a queue-only account with the password the officer typed,
 * changed at the first sign-in. At most 25 per call.
 */
export async function importQueueAccounts(employeeIds: string[], password: string): Promise<{ results: ImportResult[]; error?: string }> {
  await officer();
  if (employeeIds.length > 25) return { results: [], error: "At most 25 at a time." };
  if (password && password.length < 8) return { results: [], error: "The password must have at least 8 characters." };
  const admin = createAdminClient();
  const [{ data: people }, { data: users }] = await Promise.all([
    admin.from("self_audit_queue_employees").select("id, name, title, email, branch_id, queue_role").in("id", employeeIds),
    admin.from("self_audit_users").select("id, email"),
  ]);
  const byEmail = new Map((users ?? []).map((u) => [u.email.trim().toLowerCase(), u.id]));
  const one = async (p: NonNullable<typeof people>[number]): Promise<ImportResult> => {
    const email = (p.email ?? "").replace(/[\s​]/g, "").toLowerCase();
    const base = { employeeId: p.id, name: p.name, email };
    if (!p.queue_role) return { ...base, outcome: "error", message: "No queue role." };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ...base, outcome: "error", message: "No valid e-mail." };
    const existing = byEmail.get(email);
    if (existing) {
      const { error } = await admin.from("self_audit_users").update({ queue_role: p.queue_role, job_title: p.title }).eq("id", existing);
      return error ? { ...base, outcome: "error", message: error.message } : { ...base, outcome: "linked" };
    }
    if (!password) return { ...base, outcome: "error", message: "Type the first password to create new accounts." };
    // A branch person needs the branch; a head office queue manager / parts person may have none.
    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (createError || !created.user) return { ...base, outcome: "error", message: createError?.message ?? "Could not create the account." };
    const { error } = await admin.from("self_audit_users").insert({
      id: created.user.id,
      email,
      full_name: p.name,
      role: "queue_user",
      branch_id: p.branch_id,
      queue_role: p.queue_role,
      job_title: p.title,
      must_change_password: true,
    });
    if (error) {
      await admin.auth.admin.deleteUser(created.user.id);
      return { ...base, outcome: "error", message: error.message };
    }
    byEmail.set(email, created.user.id);
    return { ...base, outcome: "created" };
  };
  const results: ImportResult[] = [];
  for (const p of people ?? []) results.push(await one(p));
  revalidatePath("/queue/admin");
  revalidatePath("/admin/branches");
  return { results };
}

export async function updateEmployee(
  id: string,
  input: { name: string; title: string; city: string; branchId: string; phone: string; email: string }
): Promise<{ error?: string }> {
  await officer();
  const name = input.name.trim().slice(0, 120);
  if (!name) return { error: "Name is required." };
  const admin = createAdminClient();
  let branchName: string | null = null;
  if (input.branchId) {
    const { data: b } = await admin.from("self_audit_branches").select("name").eq("id", input.branchId).maybeSingle();
    branchName = b?.name ?? null;
  }
  const { error } = await admin
    .from("self_audit_queue_employees")
    .update({
      name,
      title: input.title.trim().slice(0, 120) || null,
      city: input.city.trim().slice(0, 60) || null,
      branch_id: input.branchId || null,
      ...(input.branchId ? { branch_name: branchName } : {}),
      phone: input.phone.trim().slice(0, 30) || null,
      email: input.email.trim().slice(0, 120) || null,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/queue/team");
  return {};
}
