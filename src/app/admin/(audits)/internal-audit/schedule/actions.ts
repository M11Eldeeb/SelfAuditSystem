"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const PATH = "/admin/internal-audit/schedule";
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));

/** How many internal audits a branch gets this year (0-4). Extra slots are removed - never one already used by an audit. */
export async function setBranchAuditCount(year: number, branchId: string, count: number): Promise<{ error?: string }> {
  const officer = await requireRole("officer");
  if (!Number.isInteger(year) || !Number.isInteger(count) || count < 0 || count > 4) return { error: "Choose 0 to 4 audits." };
  const admin = createAdminClient();
  const { data: slots } = await admin.from("self_audit_ia_schedule").select("id, slot, internal_audit_id").eq("year", year).eq("branch_id", branchId);
  const have = new Map((slots ?? []).map((s) => [s.slot, s]));
  const used = (slots ?? []).filter((s) => s.slot > count && s.internal_audit_id);
  if (used.length) return { error: `Audit ${used.map((s) => s.slot).join(", ")} already has an audit list - it cannot be removed.` };
  const add = [1, 2, 3, 4].filter((n) => n <= count && !have.has(n)).map((slot) => ({ year, branch_id: branchId, slot, updated_by: officer.id }));
  if (add.length) {
    const { error } = await admin.from("self_audit_ia_schedule").insert(add);
    if (error) return { error: error.message };
  }
  const remove = (slots ?? []).filter((s) => s.slot > count).map((s) => s.id);
  if (remove.length) await admin.from("self_audit_ia_schedule").delete().in("id", remove);
  revalidatePath(PATH);
  return {};
}

/** The planned date of one audit (null clears it). */
export async function setAuditDate(slotId: string, date: string | null): Promise<{ error?: string }> {
  const officer = await requireRole("officer");
  if (date && !isDate(date)) return { error: "Invalid date." };
  const admin = createAdminClient();
  const { data: slot } = await admin.from("self_audit_ia_schedule").select("year").eq("id", slotId).maybeSingle();
  if (!slot) return { error: "Not found." };
  if (date && Number(date.slice(0, 4)) !== slot.year) return { error: `Pick a date in ${slot.year}.` };
  const { error } = await admin.from("self_audit_ia_schedule").update({ planned_date: date, updated_by: officer.id, updated_at: new Date().toISOString() }).eq("id", slotId);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return {};
}

/** Adds a holiday (one day or a range of days). */
export async function addHoliday(from: string, to: string, name: string): Promise<{ error?: string }> {
  const officer = await requireRole("officer");
  const label = name.trim().slice(0, 80);
  if (!label) return { error: "Enter the holiday name." };
  if (!isDate(from) || (to && !isDate(to))) return { error: "Pick the dates." };
  const end = to && to >= from ? to : from;
  const days: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= end && days.length < 31; d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
  const { error } = await createAdminClient()
    .from("self_audit_holidays")
    .upsert(days.map((day) => ({ day, name: label, official: false, created_by: officer.id })), { onConflict: "day,name", ignoreDuplicates: true });
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return {};
}

/** Removes a holiday - every day of it (same name, same year). */
export async function removeHoliday(name: string, year: number): Promise<{ error?: string }> {
  await requireRole("officer");
  const { error } = await createAdminClient().from("self_audit_holidays").delete().eq("name", name).gte("day", `${year}-01-01`).lte("day", `${year}-12-31`);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return {};
}
