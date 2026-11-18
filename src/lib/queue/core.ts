// The customer queue (moved from the MG Queue app): types, the English / Arabic labels and the ranking that "Call next
// customer" uses. Shared by the browser and the server.

export type ServiceMode = "appointment" | "walk_in" | "inquiry" | "spare_parts";
export type WipServiceType = "general_repair" | "quick_service" | "vehicle_delivery";
export type TicketStatus = "waiting" | "called" | "in_service" | "completed" | "no_show" | "cancelled" | "held";
export type Tier = "inquiry" | "appointment" | "vehicle_delivery" | "general_repair" | "quick_service";
export type Lang = "en" | "ar";

export type QueueTicket = {
  id: string;
  branch_id: string;
  ticket_number: string | null;
  customer_name: string;
  mobile: string;
  service_mode: ServiceMode;
  wip_service_type: WipServiceType | null;
  wip_number: string | null;
  status: TicketStatus;
  advisor_id: string | null;
  advisor_name: string | null;
  preassigned_advisor_id: string | null;
  preassigned_advisor_name: string | null;
  preassign_urgent: boolean;
  held_at: string | null;
  was_held: boolean;
  notes: string | null;
  queue_entry_at: string;
  served_at: string | null;
  closed_at: string | null;
  /** Came for an appointment of the DMS sheet: its time (shown at the desk). */
  appointment_at?: string | null;
  /** All the services asked for (Quick Service and General Repair may go together). */
  services?: string[] | null;
  /** What the customer added at the kiosk, and what they changed from the appointment sheet. */
  customer_note?: string | null;
  customer_changes?: Record<string, { from: unknown; to: unknown }> | null;
};

export type QueueSettings = { priority_order: Tier[]; fairness_enabled: boolean; fairness_override_minutes: number };

export const ALL_TIERS: Tier[] = ["inquiry", "appointment", "vehicle_delivery", "general_repair", "quick_service"];
export const DEFAULT_SETTINGS: QueueSettings = { priority_order: ALL_TIERS, fairness_enabled: true, fairness_override_minutes: 15 };

/** [English, Arabic] */
export const TIER_LABEL: Record<Tier, [string, string]> = {
  inquiry: ["Inquiry", "استفسار"],
  appointment: ["Appointment", "موعد مسبق"],
  vehicle_delivery: ["Receive vehicle after repair / quick service", "استلام المركبة بعد الإصلاح/الخدمة السريعة"],
  general_repair: ["General Repair", "إصلاح عام"],
  quick_service: ["Quick Service", "خدمة سريعة"],
};
export const MODE_LABEL: Record<ServiceMode, [string, string]> = {
  appointment: ["Appointment", "موعد مسبق"],
  walk_in: ["Walk-in", "بدون موعد"],
  inquiry: ["Inquiry", "استفسار"],
  spare_parts: ["Spare Parts", "قطع غيار"],
};
export const WIP_LABEL: Record<WipServiceType, [string, string]> = {
  general_repair: TIER_LABEL.general_repair,
  quick_service: TIER_LABEL.quick_service,
  vehicle_delivery: TIER_LABEL.vehicle_delivery,
};
export const STATUS_LABEL: Record<TicketStatus, [string, string]> = {
  waiting: ["Waiting", "بالانتظار"],
  called: ["Called", "تم الاستدعاء"],
  in_service: ["In service", "قيد الخدمة"],
  completed: ["Completed", "مكتملة"],
  no_show: ["No show", "لم يحضر"],
  cancelled: ["Cancelled", "ملغاة"],
  held: ["On hold", "معلّقة"],
};

export const tr = (lang: Lang) => (en: string, ar: string) => (lang === "ar" ? ar : en);
export const label = (pair: [string, string], lang: Lang) => (lang === "ar" ? pair[1] : pair[0]);

/** What the ticket is for, in a few words. */
export function serviceText(tk: Pick<QueueTicket, "service_mode" | "wip_service_type"> & { services?: string[] | null }, lang: Lang) {
  if (tk.service_mode === "inquiry" || tk.service_mode === "spare_parts") return label(MODE_LABEL[tk.service_mode], lang);
  const many = (tk.services ?? []).filter((s): s is WipServiceType => s in WIP_LABEL);
  if (many.length > 1) return many.map((s) => label(WIP_LABEL[s], lang)).join(" + ");
  return tk.wip_service_type ? label(WIP_LABEL[tk.wip_service_type], lang) : label(MODE_LABEL[tk.service_mode], lang);
}

/** A saved order from before every tier existed: the missing ones are added at the end, so none is ever unreachable. */
export function fullOrder(order: unknown): Tier[] {
  const known = (Array.isArray(order) ? order : []).filter((t): t is Tier => ALL_TIERS.includes(t as Tier));
  const uniq = Array.from(new Set(known));
  return [...uniq, ...ALL_TIERS.filter((t) => !uniq.includes(t))];
}

export function tierOf(tk: Pick<QueueTicket, "service_mode" | "wip_service_type">): Tier | null {
  if (tk.service_mode === "inquiry") return "inquiry";
  if (tk.service_mode === "appointment") return "appointment";
  if (tk.wip_service_type === "vehicle_delivery") return "vehicle_delivery";
  if (tk.wip_service_type === "general_repair") return "general_repair";
  if (tk.wip_service_type === "quick_service") return "quick_service";
  return null;
}

/**
 * "Call next customer": an urgent reservation for this advisor first; tickets reserved for another advisor are left
 * out; then a customer reactivated from hold; then the branch's tier order (oldest first in each tier). Quick Service
 * (it carries an incentive) is shared fairly between the advisors - the one with the fewest today takes it - unless
 * the customer has waited longer than the branch's fairness window. `waiting` must be oldest first.
 */
export function pickNext(
  waiting: QueueTicket[],
  advisorId: string,
  quickServiceToday: Record<string, number>,
  settings: QueueSettings,
  now = Date.now()
): QueueTicket | null {
  const urgent = waiting.find((tk) => tk.preassigned_advisor_id === advisorId && tk.preassign_urgent);
  if (urgent) return urgent;
  const eligible = waiting.filter((tk) => !tk.preassigned_advisor_id || tk.preassigned_advisor_id === advisorId);
  const reactivated = eligible.find((tk) => tk.was_held);
  if (reactivated) return reactivated;
  for (const tier of fullOrder(settings.priority_order)) {
    // Appointments: the earliest appointment time first, not the earliest arrival - a customer who came at 08:30 for
    // 09:00 goes before one who came at 08:00 for 12:00.
    const oldest = tier === "appointment" ? byAppointmentTime(eligible.filter((tk) => tierOf(tk) === tier))[0] : eligible.find((tk) => tierOf(tk) === tier);
    if (!oldest) continue;
    if (tier === "quick_service" && settings.fairness_enabled) {
      const waitedMin = (now - new Date(oldest.queue_entry_at).getTime()) / 60000;
      if (waitedMin > settings.fairness_override_minutes) return oldest;
      const mine = quickServiceToday[advisorId] ?? 0;
      const counts = Object.values(quickServiceToday);
      if (mine <= (counts.length ? Math.min(...counts) : 0)) return oldest;
      continue; // not this advisor's fair turn
    }
    return oldest;
  }
  // Nothing in a tier (e.g. a walk-in without a service): the oldest one left.
  return eligible.find((tk) => tierOf(tk) == null) ?? null;
}

/** Appointment tickets by appointment time (one without a time by when it joined), earliest first. */
export function byAppointmentTime<T extends Pick<QueueTicket, "queue_entry_at" | "appointment_at">>(list: T[]): T[] {
  const at = (tk: T) => new Date(tk.appointment_at ?? tk.queue_entry_at).getTime();
  return [...list].sort((a, b) => at(a) - at(b) || new Date(a.queue_entry_at).getTime() - new Date(b.queue_entry_at).getTime());
}

/** Saudi mobile as typed (5X XXX XXXX, with or without 0 / +966) to +9665XXXXXXXX; null if it is not one. */
export function normalizeMobile(raw: string): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("00966")) d = d.slice(5);
  else if (d.startsWith("966")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  return /^5\d{8}$/.test(d) ? `+966${d}` : null;
}

export function minutesSince(iso: string | null, now = Date.now()) {
  return iso ? Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000)) : 0;
}

/** Start of today in Saudi time, as an ISO string. */
export function startOfSaudiDay(daysBack = 0, now = new Date()): string {
  const riyadh = new Date(now.getTime() + 3 * 3600_000);
  const d = Date.UTC(riyadh.getUTCFullYear(), riyadh.getUTCMonth(), riyadh.getUTCDate() - daysBack) - 3 * 3600_000;
  return new Date(d).toISOString();
}

/** YYYY-MM-DD in Saudi time. */
export const saudiDate = (iso: string) => new Date(new Date(iso).getTime() + 3 * 3600_000).toISOString().slice(0, 10);
export const saudiHour = (iso: string) => new Date(new Date(iso).getTime() + 3 * 3600_000).getUTCHours();
export const saudiWeekday = (iso: string) => new Date(new Date(iso).getTime() + 3 * 3600_000).getUTCDay();

export type DailyStat = { date: string; tickets: number; served: number; avgWaitMin: number | null; avgServiceMin: number | null };

type StatTicket = { status: string; queue_entry_at: string; served_at: string | null; closed_at: string | null };

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function dailyStats(tickets: StatTicket[], days: number): DailyStat[] {
  const keys = Array.from({ length: days }, (_, i) => saudiDate(startOfSaudiDay(days - 1 - i)));
  const byDay = new Map<string, StatTicket[]>();
  for (const tk of tickets) {
    const k = saudiDate(tk.queue_entry_at);
    byDay.set(k, [...(byDay.get(k) ?? []), tk]);
  }
  return keys.map((date) => {
    const list = byDay.get(date) ?? [];
    const done = list.filter((tk) => tk.status === "completed");
    return {
      date,
      tickets: list.length,
      served: done.length,
      avgWaitMin: avg(list.filter((tk) => tk.served_at).map((tk) => (+new Date(tk.served_at!) - +new Date(tk.queue_entry_at)) / 60000)),
      avgServiceMin: avg(done.filter((tk) => tk.served_at && tk.closed_at).map((tk) => (+new Date(tk.closed_at!) - +new Date(tk.served_at!)) / 60000)),
    };
  });
}

export function hourlyCounts(tickets: StatTicket[]) {
  const c = new Array(24).fill(0) as number[];
  for (const tk of tickets) c[saudiHour(tk.queue_entry_at)]++;
  return c.map((count, hour) => ({ hour, count }));
}

const DAYS: [string, string][] = [["Sun", "أحد"], ["Mon", "اثنين"], ["Tue", "ثلاثاء"], ["Wed", "أربعاء"], ["Thu", "خميس"], ["Fri", "جمعة"], ["Sat", "سبت"]];
export function weekdayCounts(tickets: StatTicket[], lang: Lang) {
  const c = new Array(7).fill(0) as number[];
  for (const tk of tickets) c[saudiWeekday(tk.queue_entry_at)]++;
  return c.map((count, i) => ({ day: label(DAYS[i], lang), count }));
}

export const busyLevel = (waiting: number) => (waiting > 8 ? "busy" : waiting > 3 ? "moderate" : "quiet");
