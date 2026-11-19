"use server";

// The customer queue's staff side: the service and spare parts desks, queue settings. Every action checks the person's
// queue access (lib/queue/server) and that the ticket is in a branch they may work in.

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanSchedule, saudiNow, type Receiving } from "@/lib/queue/hours";
import { branchReceiving, getQueueAccess, canUseBranch, branchSettings, pushTurnAlert, effectiveQueueRole, type QueueAccess } from "@/lib/queue/server";
import { ALL_TIERS, fullOrder, pickNext, startOfSaudiDay, type QueueTicket, type QueueSettings, type Tier, type TicketStatus } from "@/lib/queue/core";
import type { Database } from "@/lib/supabase/types";

type Kind = "service" | "parts";
const DAY_MS = 24 * 3600_000;

async function access(): Promise<QueueAccess> {
  const a = await getQueueAccess();
  if (!a) throw new Error("No queue access.");
  return a;
}

/** May this person use this desk (service / parts) in this branch? */
function canUseDesk(a: QueueAccess, branchId: string, kind: Kind) {
  if (!canUseBranch(a, branchId)) return false;
  if (a.role === "manager") return true;
  return kind === "parts" ? a.role === "parts_advisor" : a.role === "advisor";
}

const kindOf = (tk: { service_mode: string }): Kind => (tk.service_mode === "spare_parts" ? "parts" : "service");

async function ticketFor(a: QueueAccess, ticketId: string) {
  const { data } = await createAdminClient().from("self_audit_queue_tickets").select("*").eq("id", ticketId).maybeSingle();
  if (!data || !canUseDesk(a, data.branch_id, kindOf(data))) return null;
  return data as QueueTicket;
}

const meName = (a: QueueAccess) => a.user.full_name || a.user.email;

export type DeskAdvisor = { id: string; name: string };
export type DeskBoard = {
  me: { id: string; name: string; role: QueueAccess["role"] };
  waiting: QueueTicket[];
  /** Tickets called / in service right now (mine first). */
  active: QueueTicket[];
  noShows: QueueTicket[];
  held: QueueTicket[];
  advisors: DeskAdvisor[];
  settings: QueueSettings;
  servedToday: number;
  receiving: Receiving;
};

/** Everything a desk shows, read again every few seconds. */
export async function getDeskBoard(branchId: string, kind: Kind): Promise<DeskBoard | { error: string }> {
  const a = await access();
  if (!canUseDesk(a, branchId, kind)) return { error: "You do not work in this queue." };
  const admin = createAdminClient();
  const parts = (q: ReturnType<ReturnType<typeof admin.from>["select"]>) => (kind === "parts" ? q.eq("service_mode", "spare_parts") : q.neq("service_mode", "spare_parts"));
  const t = () => admin.from("self_audit_queue_tickets").select("*").eq("branch_id", branchId);
  const [open, noShows, held, served, settings, advisors] = await Promise.all([
    parts(t().in("status", ["waiting", "called", "in_service"])).order("queue_entry_at", { ascending: true }),
    parts(t().eq("status", "no_show")).gte("queue_entry_at", startOfSaudiDay()).order("queue_entry_at", { ascending: false }).limit(10),
    parts(t().eq("status", "held")).gte("held_at", new Date(Date.now() - DAY_MS).toISOString()).order("held_at", { ascending: false }),
    parts(admin.from("self_audit_queue_tickets").select("id", { count: "exact", head: true }).eq("branch_id", branchId).eq("status", "completed")).gte("closed_at", startOfSaudiDay()),
    branchSettings(branchId),
    admin
      .from("self_audit_users")
      .select("id, full_name, email, role, queue_role")
      .eq("branch_id", branchId)
      .order("full_name"),
  ]);
  const rows = (open.data ?? []) as QueueTicket[];
  const active = rows.filter((tk) => tk.status !== "waiting").sort((x, y) => Number(y.advisor_id === a.user.id) - Number(x.advisor_id === a.user.id));
  return {
    me: { id: a.user.id, name: meName(a), role: a.role },
    waiting: rows.filter((tk) => tk.status === "waiting"),
    active: a.role === "manager" ? active : active.filter((tk) => tk.advisor_id === a.user.id),
    noShows: (noShows.data ?? []) as QueueTicket[],
    held: (held.data ?? []) as QueueTicket[],
    advisors: (advisors.data ?? [])
      .filter((u) => effectiveQueueRole(u) === (kind === "parts" ? "parts_advisor" : "advisor"))
      .map((u) => ({ id: u.id, name: u.full_name || u.email })),
    settings,
    servedToday: served.count ?? 0,
    receiving: (await branchReceiving(branchId)).receiving,
  };
}

async function quickServiceToday(branchId: string): Promise<Record<string, number>> {
  const { data } = await createAdminClient()
    .from("self_audit_queue_tickets")
    .select("advisor_id")
    .eq("branch_id", branchId)
    .eq("wip_service_type", "quick_service")
    .gte("served_at", startOfSaudiDay());
  const out: Record<string, number> = {};
  for (const r of data ?? []) if (r.advisor_id) out[r.advisor_id] = (out[r.advisor_id] ?? 0) + 1;
  return out;
}

/** Marks a waiting ticket as called by me - only if nobody took it a moment earlier. */
async function claim(a: QueueAccess, ticketId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("self_audit_queue_tickets")
    .update({
      status: "called",
      served_at: new Date().toISOString(),
      advisor_id: a.user.id,
      advisor_name: meName(a),
      preassigned_advisor_id: null,
      preassigned_advisor_name: null,
      preassign_urgent: false,
      was_held: false,
    })
    .eq("id", ticketId)
    .eq("status", "waiting")
    .select("id");
  if (!data?.length) return false;
  void pushTurnAlert(ticketId);
  return true;
}

/** "Call next customer": the ranking of the branch settings; a ticket someone else took first is skipped. */
export async function callNextCustomer(branchId: string, kind: Kind): Promise<{ ticketId?: string; error?: string }> {
  const a = await access();
  if (!canUseDesk(a, branchId, kind)) return { error: "You do not work in this queue." };
  const admin = createAdminClient();
  const [settings, counts] = await Promise.all([branchSettings(branchId), kind === "service" ? quickServiceToday(branchId) : Promise.resolve({})]);
  for (let attempt = 0; attempt < 3; attempt++) {
    let q = admin.from("self_audit_queue_tickets").select("*").eq("branch_id", branchId).eq("status", "waiting");
    q = kind === "parts" ? q.eq("service_mode", "spare_parts") : q.neq("service_mode", "spare_parts");
    const { data } = await q.order("queue_entry_at", { ascending: true });
    const waiting = (data ?? []) as QueueTicket[];
    const next = kind === "parts" ? waiting.find((tk) => tk.preassigned_advisor_id === a.user.id && tk.preassign_urgent) ?? waiting.find((tk) => !tk.preassigned_advisor_id || tk.preassigned_advisor_id === a.user.id) ?? null : pickNext(waiting, a.user.id, counts, settings);
    if (!next) return { error: "No customer for you right now. · لا يوجد عميل متاح لك الآن." };
    if (await claim(a, next.id)) return { ticketId: next.id };
  }
  return { error: "The queue is busy - try again. · حاول مرة أخرى." };
}

/** "Serve now" on one waiting ticket (managers, and the spare parts desk). */
export async function serveTicket(ticketId: string): Promise<{ error?: string }> {
  const a = await access();
  const tk = await ticketFor(a, ticketId);
  if (!tk) return { error: "Ticket not found." };
  if (a.role === "advisor") return { error: "Use Call next customer." };
  return (await claim(a, ticketId)) ? {} : { error: "Someone else called this customer." };
}

type TicketUpdate = Database["public"]["Tables"]["self_audit_queue_tickets"]["Update"];

async function update(a: QueueAccess, ticketId: string, from: TicketStatus[], values: TicketUpdate): Promise<{ error?: string }> {
  const tk = await ticketFor(a, ticketId);
  if (!tk) return { error: "Ticket not found." };
  const { data, error } = await createAdminClient().from("self_audit_queue_tickets").update(values).eq("id", ticketId).in("status", from).select("id");
  if (error) return { error: error.message };
  return data?.length ? {} : { error: "This ticket has already moved on." };
}

export async function completeTicket(ticketId: string, wipNumber: string): Promise<{ error?: string }> {
  const a = await access();
  const wip = String(wipNumber ?? "").trim().slice(0, 30);
  return update(a, ticketId, ["called", "in_service"], { status: "completed", closed_at: new Date().toISOString(), ...(wip ? { wip_number: wip } : {}) });
}

export async function saveTicketNotes(ticketId: string, notes: string): Promise<{ error?: string }> {
  const a = await access();
  return update(a, ticketId, ["waiting", "called", "in_service", "held"], { notes: String(notes ?? "").trim().slice(0, 2000) || null });
}

export async function startService(ticketId: string): Promise<{ error?: string }> {
  return update(await access(), ticketId, ["called"], { status: "in_service" });
}

export async function markNoShow(ticketId: string): Promise<{ error?: string }> {
  return update(await access(), ticketId, ["called", "in_service"], { status: "no_show" });
}

/** On hold for 24 hours: the customer (or the desk) can bring it back with priority. */
export async function holdTicket(ticketId: string): Promise<{ error?: string }> {
  return update(await access(), ticketId, ["called", "in_service"], { status: "held", held_at: new Date().toISOString() });
}

export async function reactivateTicket(ticketId: string): Promise<{ error?: string }> {
  return update(await access(), ticketId, ["held"], { status: "waiting", was_held: true, advisor_id: null, advisor_name: null, served_at: null });
}

/** A no-show back at the end of the line. */
export async function returnToQueue(ticketId: string): Promise<{ error?: string }> {
  return update(await access(), ticketId, ["no_show", "called"], {
    status: "waiting",
    queue_entry_at: new Date().toISOString(),
    advisor_id: null,
    advisor_name: null,
    served_at: null,
  });
}

/** A manager reserves a waiting customer for one advisor (urgent = served next by that advisor); null clears it. */
export async function assignTicket(ticketId: string, advisorId: string | null, urgent: boolean): Promise<{ error?: string }> {
  const a = await access();
  if (a.role !== "manager") return { error: "Only the queue manager assigns customers." };
  const tk = await ticketFor(a, ticketId);
  if (!tk) return { error: "Ticket not found." };
  if (!advisorId) return update(a, ticketId, ["waiting"], { preassigned_advisor_id: null, preassigned_advisor_name: null, preassign_urgent: false });
  const { data: adv } = await createAdminClient().from("self_audit_users").select("id, full_name, email, branch_id, queue_role, role").eq("id", advisorId).maybeSingle();
  if (!adv || adv.branch_id !== tk.branch_id || !effectiveQueueRole(adv)) return { error: "That advisor is not in this branch's queue." };
  return update(a, ticketId, ["waiting"], { preassigned_advisor_id: adv.id, preassigned_advisor_name: adv.full_name || adv.email, preassign_urgent: !!urgent });
}

/** The customer is handed to the branch's queue manager (or else its service manager). */
export async function transferToManager(ticketId: string): Promise<{ error?: string; name?: string }> {
  const a = await access();
  const tk = await ticketFor(a, ticketId);
  if (!tk) return { error: "Ticket not found." };
  const admin = createAdminClient();
  const { data: managers } = await admin
    .from("self_audit_users")
    .select("id, full_name, email, queue_role, role")
    .eq("branch_id", tk.branch_id)
    .or("queue_role.eq.manager,role.eq.service_manager");
  const m = (managers ?? []).filter((u) => u.id !== a.user.id).sort((x, y) => Number(y.queue_role === "manager") - Number(x.queue_role === "manager"))[0];
  if (!m) return { error: "No queue manager is set for this branch." };
  const name = m.full_name || m.email;
  const r = await update(a, ticketId, ["called", "in_service"], { advisor_id: m.id, advisor_name: name });
  return r.error ? r : { name };
}

/** Working hours of the branch (one entry per weekday, 0 = Sunday). */
export async function saveWorkingHours(branchId: string, schedule: unknown): Promise<{ error?: string }> {
  const a = await access();
  if (a.role !== "manager" || !canUseBranch(a, branchId) || a.user.viewOnly) return { error: "Only the queue manager changes the working hours." };
  const clean = cleanSchedule(schedule);
  const { error } = await createAdminClient()
    .from("self_audit_queue_settings")
    .upsert({ branch_id: branchId, schedule: clean, updated_by: meName(a), updated_at: new Date().toISOString() });
  if (error) return { error: error.message };
  revalidatePath("/queue", "layout");
  return {};
}

/** Receiving now: follow the hours ("auto"), or open / closed for the rest of today. */
export async function setReceiving(branchId: string, mode: "auto" | "open" | "closed"): Promise<{ error?: string }> {
  const a = await access();
  if (a.role !== "manager" || !canUseBranch(a, branchId) || a.user.viewOnly) return { error: "Only the queue manager opens or closes receiving." };
  const { error } = await createAdminClient()
    .from("self_audit_queue_settings")
    .upsert({
      branch_id: branchId,
      receiving_override: mode === "auto" ? null : mode,
      override_date: mode === "auto" ? null : saudiNow().date,
      updated_by: meName(a),
      updated_at: new Date().toISOString(),
    });
  if (error) return { error: error.message };
  revalidatePath("/queue", "layout");
  return {};
}

export async function saveQueueSettings(branchId: string, order: string[], fairnessEnabled: boolean, overrideMinutes: number): Promise<{ error?: string }> {
  const a = await access();
  if (a.role !== "manager" || !canUseBranch(a, branchId) || a.user.viewOnly) return { error: "Only the queue manager changes the settings." };
  const minutes = Math.round(Number(overrideMinutes));
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 240) return { error: "The fairness window is 0 to 240 minutes." };
  const clean = fullOrder(order.filter((t): t is Tier => ALL_TIERS.includes(t as Tier)));
  const { error } = await createAdminClient()
    .from("self_audit_queue_settings")
    .upsert({ branch_id: branchId, priority_order: clean, fairness_enabled: !!fairnessEnabled, fairness_override_minutes: minutes, updated_by: meName(a), updated_at: new Date().toISOString() });
  if (error) return { error: error.message };
  revalidatePath("/queue", "layout");
  return {};
}
