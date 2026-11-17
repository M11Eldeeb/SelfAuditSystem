"use server";

// The customer queue's public side (no sign-in): joining at the branch (QR / kiosk), the customer's ticket page,
// "find my ticket" by mobile and the branch TV. Each action reads or changes only what that page needs; the TV never
// gets customer names or mobiles.

import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeMobile, startOfSaudiDay, type ServiceMode, type WipServiceType, type QueueTicket } from "@/lib/queue/core";

const MODES: ServiceMode[] = ["appointment", "walk_in", "inquiry", "spare_parts"];
const WIPS: WipServiceType[] = ["general_repair", "quick_service", "vehicle_delivery"];
const ACTIVE = ["waiting", "called", "in_service"] as const;
const DAY_MS = 24 * 3600_000;

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

async function openBranch(branchId: string) {
  if (!isUuid(branchId)) return null;
  const { data } = await createAdminClient()
    .from("self_audit_branches")
    .select("id, active, queue_code, queue_status")
    .eq("id", branchId)
    .maybeSingle();
  return data && data.active && data.queue_code ? data : null;
}

/** Before joining: a ticket this mobile already has in the branch (active, or held in the last 24 hours). */
export async function checkExistingTicket(branchId: string, mobileRaw: string): Promise<{ type: "active" | "held"; id: string; ticketNumber: string } | null> {
  const mobile = normalizeMobile(mobileRaw);
  if (!mobile || !(await openBranch(branchId))) return null;
  const admin = createAdminClient();
  const { data: active } = await admin
    .from("self_audit_queue_tickets")
    .select("id, ticket_number")
    .eq("branch_id", branchId)
    .eq("mobile", mobile)
    .in("status", [...ACTIVE])
    .order("queue_entry_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (active) return { type: "active", id: active.id, ticketNumber: active.ticket_number ?? "" };
  const { data: held } = await admin
    .from("self_audit_queue_tickets")
    .select("id, ticket_number")
    .eq("branch_id", branchId)
    .eq("mobile", mobile)
    .eq("status", "held")
    .gte("held_at", new Date(Date.now() - DAY_MS).toISOString())
    .order("held_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return held ? { type: "held", id: held.id, ticketNumber: held.ticket_number ?? "" } : null;
}

export async function joinQueue(input: {
  branchId: string;
  name: string;
  mobile: string;
  mode: string;
  wip?: string | null;
  wipNumber?: string | null;
}): Promise<{ id?: string; error?: string }> {
  const branch = await openBranch(input.branchId);
  if (!branch) return { error: "Branch not found. · الفرع غير موجود." };
  if (branch.queue_status !== "open") return { error: "The queue is not taking new customers right now. · الطابور لا يستقبل عملاء جدد حالياً." };
  const name = String(input.name ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const mobile = normalizeMobile(input.mobile);
  const mode = MODES.find((m) => m === input.mode);
  if (!name || !mobile || !mode) return { error: "Enter your name, a Saudi mobile number (5X XXX XXXX) and the service. · أدخل الاسم ورقم الجوال والخدمة." };
  const needsWip = mode === "appointment" || mode === "walk_in";
  const wip = needsWip ? WIPS.find((w) => w === input.wip) ?? null : null;
  if (needsWip && !wip) return { error: "Choose what you need. · اختر الخدمة المطلوبة." };
  const wipNumber = mode === "appointment" ? String(input.wipNumber ?? "").trim().slice(0, 30) : "";
  if (mode === "appointment" && !wipNumber) return { error: "Enter the WIP number of your appointment. · أدخل رقم WIP." };

  const { data, error } = await createAdminClient()
    .from("self_audit_queue_tickets")
    .insert({ branch_id: branch.id, customer_name: name, mobile, service_mode: mode, wip_service_type: wip, wip_number: wipNumber || null, status: "waiting" })
    .select("id")
    .single();
  if (error || !data) return { error: "Something went wrong. Please try again. · حدث خطأ، حاول مرة أخرى." };
  return { id: data.id };
}

/** A held ticket (last 24 hours) back in the queue, ahead of new arrivals. */
export async function rejoinHeldTicket(ticketId: string): Promise<{ ok?: boolean; error?: string }> {
  if (!isUuid(ticketId)) return { error: "Ticket not found." };
  const { data, error } = await createAdminClient()
    .from("self_audit_queue_tickets")
    .update({ status: "waiting", was_held: true, advisor_id: null, advisor_name: null, served_at: null })
    .eq("id", ticketId)
    .eq("status", "held")
    .gte("held_at", new Date(Date.now() - DAY_MS).toISOString())
    .select("id");
  if (error || !data?.length) return { error: "This ticket can no longer be reactivated. · لا يمكن إعادة تنشيط هذه التذكرة." };
  return { ok: true };
}

export type TicketView = {
  ticket: Pick<QueueTicket, "id" | "ticket_number" | "status" | "service_mode" | "wip_service_type" | "advisor_name" | "served_at" | "queue_entry_at">;
  branch: { name: string; name_ar: string | null; queue_code: string | null };
  position: number | null; // people ahead + 1 while waiting
};

/** The customer's ticket page: status, branch and place in line (same queue: service or spare parts). */
export async function getTicketView(ticketId: string): Promise<TicketView | null> {
  if (!isUuid(ticketId)) return null;
  const admin = createAdminClient();
  const { data: tk } = await admin
    .from("self_audit_queue_tickets")
    .select("id, branch_id, ticket_number, status, service_mode, wip_service_type, advisor_name, served_at, queue_entry_at")
    .eq("id", ticketId)
    .maybeSingle();
  if (!tk) return null;
  const { data: branch } = await admin.from("self_audit_branches").select("name, name_ar, queue_code").eq("id", tk.branch_id).maybeSingle();
  let position: number | null = null;
  if (tk.status === "waiting") {
    let q = admin
      .from("self_audit_queue_tickets")
      .select("id", { count: "exact", head: true })
      .eq("branch_id", tk.branch_id)
      .eq("status", "waiting")
      .lt("queue_entry_at", tk.queue_entry_at);
    q = tk.service_mode === "spare_parts" ? q.eq("service_mode", "spare_parts") : q.neq("service_mode", "spare_parts");
    const { count } = await q;
    position = (count ?? 0) + 1;
  }
  const { branch_id: _b, ...ticket } = tk;
  void _b;
  return { ticket, branch: branch ?? { name: "", name_ar: null, queue_code: null }, position };
}

/** "Find my ticket": the active tickets of this mobile, and the held ones (last 24 hours) that can be reactivated. */
export async function findTicketsByMobile(mobileRaw: string): Promise<{
  error?: string;
  active: { id: string; ticket_number: string | null; branch: string; branch_ar: string | null }[];
  held: { id: string; ticket_number: string | null; branch: string; branch_ar: string | null }[];
}> {
  const mobile = normalizeMobile(mobileRaw);
  if (!mobile) return { error: "Enter a Saudi mobile number (5X XXX XXXX). · أدخل رقم جوال صحيح.", active: [], held: [] };
  const admin = createAdminClient();
  const [{ data: active }, { data: held }, { data: branches }] = await Promise.all([
    admin.from("self_audit_queue_tickets").select("id, ticket_number, branch_id").eq("mobile", mobile).in("status", [...ACTIVE]).order("queue_entry_at", { ascending: false }).limit(10),
    admin
      .from("self_audit_queue_tickets")
      .select("id, ticket_number, branch_id")
      .eq("mobile", mobile)
      .eq("status", "held")
      .gte("held_at", new Date(Date.now() - DAY_MS).toISOString())
      .order("held_at", { ascending: false })
      .limit(10),
    admin.from("self_audit_branches").select("id, name, name_ar"),
  ]);
  const b = new Map((branches ?? []).map((x) => [x.id, x]));
  const shape = (r: { id: string; ticket_number: string | null; branch_id: string }) => ({
    id: r.id,
    ticket_number: r.ticket_number,
    branch: b.get(r.branch_id)?.name ?? "",
    branch_ar: b.get(r.branch_id)?.name_ar ?? null,
  });
  return { active: (active ?? []).map(shape), held: (held ?? []).map(shape) };
}

export type DisplayCall = { id: string; ticket_number: string | null; advisor_name: string | null; status: string; served_at: string | null; parts: boolean };

/** The branch TV: today's latest calls (ticket number and advisor only) and how many are waiting. */
export async function getDisplayView(branchId: string): Promise<{ calls: DisplayCall[]; waiting: number } | null> {
  if (!(await openBranch(branchId))) return null;
  const admin = createAdminClient();
  const [{ data }, { count }] = await Promise.all([
    admin
      .from("self_audit_queue_tickets")
      .select("id, ticket_number, advisor_name, status, served_at, service_mode")
      .eq("branch_id", branchId)
      .in("status", ["called", "in_service"])
      .gte("served_at", startOfSaudiDay())
      .order("served_at", { ascending: false })
      .limit(6),
    admin.from("self_audit_queue_tickets").select("id", { count: "exact", head: true }).eq("branch_id", branchId).eq("status", "waiting"),
  ]);
  return {
    calls: (data ?? []).map(({ service_mode, ...r }) => ({ ...r, parts: service_mode === "spare_parts" })),
    waiting: count ?? 0,
  };
}

/** This phone wants the "your turn" alert for this ticket. */
export async function saveQueuePush(ticketId: string, sub: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }): Promise<{ ok: boolean }> {
  if (!isUuid(ticketId) || !sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return { ok: false };
  if (!/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 1000) return { ok: false };
  const admin = createAdminClient();
  const { data: tk } = await admin.from("self_audit_queue_tickets").select("status").eq("id", ticketId).maybeSingle();
  if (!tk || !["waiting", "called", "held"].includes(tk.status)) return { ok: false };
  const { error } = await admin
    .from("self_audit_queue_push")
    .upsert({ ticket_id: ticketId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh.slice(0, 200), auth: sub.keys.auth.slice(0, 100) }, { onConflict: "endpoint" });
  return { ok: !error };
}
