import "server-only";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOpenWips } from "@/app/actions/open-wips";
import { getComplaintsData } from "@/app/actions/complaints";
import { vehicleQuery } from "@/app/actions/query";
import { loadFleet } from "@/lib/courtesy/fleet-server";
import { agreementsTable } from "@/lib/courtesy/agreements-server";
import { appointmentsSince, ticketsSince } from "@/lib/queue/pages";
import { getDashboardData } from "@/lib/dashboard/kpis";
import { getCachedClaimSide } from "@/lib/dashboard/cache";
import { resolveMonthRange } from "@/lib/dashboard/range";

/**
 * The portal assistant's data: what the signed-in person may see, as plain rows. Every loader goes through the portal's
 * own access rules (the server actions check the user themselves), and is narrowed to the person's branch when they have
 * one (service manager); warranty officers and the national manager see every branch.
 */

export type AssistantUser = { user: CurrentUser; branchId: string | null; label: string };

/** Who may use the assistant: warranty officers, the national manager and service managers. */
export async function assistantUser(): Promise<AssistantUser | null> {
  const user = await getCurrentUser();
  if (!user || user.must_change_password) return null;
  if (user.role === "officer") return { user, branchId: null, label: "warranty officer (every branch)" };
  if (user.role === "national_manager") return { user, branchId: null, label: "national manager (every branch, view only)" };
  if (user.role === "service_manager" && user.branch_id) return { user, branchId: user.branch_id, label: "service manager (own branch only)" };
  return null;
}

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;

const KSA = 3 * 3_600_000;
const day = (iso: string | null | undefined) => (iso ? new Date(new Date(iso).getTime() + KSA).toISOString().slice(0, 10) : null);
const todayKsa = () => new Date(Date.now() + KSA).toISOString().slice(0, 10);
const daysBetween = (from: string | null, to: string | null) => (from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) : null);
const minutes = (a: string | null, b: string | null) => (a && b ? Math.round((Date.parse(a) - Date.parse(b)) / 60_000) : null);

async function branchNames() {
  const { data } = await createAdminClient().from("self_audit_branches").select("id, name").order("name");
  return new Map((data ?? []).map((b) => [b.id, b.name]));
}

/** The datasets the assistant can query, with what each row holds (shown to the model in the tool description). */
export const DATASETS = {
  open_wips: "Open job cards (WIPs) now: branch, wip, department, status, parts_status, advisor, sale_type (Retail/Warranty/Insurance/Internal...), received, due_out, days_open, invoiceable (SAR), parts, labour, model, plate, vin, repeat_repair, courtesy_car (plate on loan for it), complaints (count), vor_lines (parts on order).",
  complaints: "MOC / SAIC / CRM complaints: source, number, created, status, resolved, days_to_resolve, category, subcategory, vin, valid, branch, advisor.",
  courtesy_cars: "Courtesy car fleet now: plate, model, branch, condition (available/maintenance/accident/on_hold/out_of_service), on_loan, loan_source (portal/old_application), customer, advisor, out_since, days_out, expires, overdue, km, next_service_km, service_state (ok/soon/due/unknown).",
  courtesy_agreements: "Courtesy car agreements in the portal (last 400 days): ref, status (requested/open/closed/cancelled), branch, customer, advisor, car, wip, handed_over, expires, returned, days_out, km_out, km_in, km_driven.",
  queue_visits: "Customer queue visits (pass days: 1-90, default 30): branch, date, hour, weekday, status (waiting/called/in_service/completed/no_show/...), service (walk_in/appointment/inquiry/spare_parts...), advisor, wait_min, service_min, appointment.",
  appointments: "DMS appointments (pass days: 1-90, default 30, up to today): branch, date, time, advisor (as named in the sheet), source (mail/upload/manual), arrived.",
  technician_claims: "Technician warranty claims: claim_no, branch, technician, work_order, status (uploading/submitted/returned/approved/rejected), submitted, reviewed, reviewed_by, times_submitted, prior_approval, defective_part_received, created.",
} as const;
export type DatasetName = keyof typeof DATASETS;

/** One dataset's rows for this person. `days` is used by the queue datasets. */
export async function loadDataset(name: DatasetName, au: AssistantUser, days = 30): Promise<Row[]> {
  const today = todayKsa();
  switch (name) {
    case "open_wips": {
      const d = await getOpenWips();
      return d.wips.map((w) => ({
        branch: w.branch,
        wip: w.wip,
        department: w.dept,
        status: w.status,
        parts_status: w.partsStatus,
        advisor: w.operator,
        sale_type: w.saleType,
        received: w.received,
        due_out: w.dueOut,
        days_open: daysBetween(w.received ?? w.firstSeen, today),
        invoiceable: w.invoiceable,
        parts: w.parts,
        labour: w.labour,
        model: w.model,
        plate: w.registration,
        vin: w.vin,
        repeat_repair: w.repeat,
        courtesy_car: w.courtesy?.open ? (w.courtesy.plate ?? "yes") : null,
        complaints: w.complaints.length,
        vor_lines: w.vor.length,
      }));
    }
    case "complaints": {
      const d = await getComplaintsData();
      return d.complaints.map((c) => ({
        source: c.source,
        number: c.no,
        created: c.created,
        status: c.status,
        resolved: c.resolved,
        days_to_resolve: daysBetween(c.created, c.resolved),
        category: c.category,
        subcategory: c.subcategory,
        vin: c.vin,
        valid: c.valid,
        branch: c.branch,
        advisor: c.advisor,
      }));
    }
    case "courtesy_cars": {
      const { rows } = await loadFleet(au.branchId);
      return rows.map((r) => {
        const out = day(r.loan?.handed_over_at);
        const expires = day(r.loan?.expires_at);
        return {
          plate: r.plate,
          model: r.model,
          branch: r.branchName,
          condition: r.condition,
          on_loan: !!r.loan,
          loan_source: r.loan ? (r.loan.source === "sheet" ? "old_application" : "portal") : null,
          customer: r.loan?.customer_name ?? null,
          advisor: r.loan?.advisor_name ?? null,
          out_since: out,
          days_out: daysBetween(out, today),
          expires,
          overdue: !!(expires && expires < today),
          km: r.km,
          next_service_km: r.service.nextKm,
          service_state: r.service.state,
        };
      });
    }
    case "courtesy_agreements": {
      let q = agreementsTable()
        .select("ref, status, branch_id, customer_name, advisor_name, vehicle_label, wip_no, handed_over_at, expires_at, returned_at, mileage_out, mileage_in, requested_at")
        .gte("requested_at", new Date(Date.now() - 400 * 86_400_000).toISOString())
        .order("requested_at", { ascending: false })
        .limit(5000);
      if (au.branchId) q = q.eq("branch_id", au.branchId);
      const [{ data }, names] = await Promise.all([q, branchNames()]);
      return ((data ?? []) as Record<string, string | number | null>[]).map((a) => {
        const out = day(a.handed_over_at as string | null);
        const back = day(a.returned_at as string | null);
        return {
          ref: a.ref as string,
          status: a.status as string,
          branch: names.get(a.branch_id as string) ?? null,
          customer: (a.customer_name as string) || null,
          advisor: a.advisor_name as string | null,
          car: a.vehicle_label as string | null,
          wip: a.wip_no as string | null,
          handed_over: out,
          expires: day(a.expires_at as string | null),
          returned: back,
          days_out: daysBetween(out, back ?? (a.status === "open" ? today : null)),
          km_out: a.mileage_out as number | null,
          km_in: a.mileage_in as number | null,
          km_driven: a.mileage_in != null && a.mileage_out != null ? (a.mileage_in as number) - (a.mileage_out as number) : null,
        };
      });
    }
    case "queue_visits": {
      const n = Math.max(1, Math.min(90, Math.round(days)));
      const [rows, names] = await Promise.all([ticketsSince(n, au.branchId ?? undefined), branchNames()]);
      return rows.map((t) => {
        const local = new Date(new Date(t.queue_entry_at).getTime() + KSA);
        return {
          branch: names.get(t.branch_id) ?? null,
          date: local.toISOString().slice(0, 10),
          hour: local.getUTCHours(),
          weekday: local.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }),
          status: t.status,
          service: t.service_mode,
          advisor: t.advisor_name,
          wait_min: minutes(t.served_at, t.queue_entry_at),
          service_min: minutes(t.closed_at, t.served_at),
          appointment: !!t.appointment_id || t.service_mode === "appointment",
        };
      });
    }
    case "appointments": {
      const n = Math.max(1, Math.min(90, Math.round(days)));
      const [appts, tickets, names] = await Promise.all([appointmentsSince(n, au.branchId ?? undefined), ticketsSince(n, au.branchId ?? undefined), branchNames()]);
      const came = new Set(tickets.map((t) => t.appointment_id).filter(Boolean));
      return appts.map((a) => ({
        branch: names.get(a.branch_id) ?? null,
        date: a.appt_date,
        time: a.appt_time?.slice(0, 5) ?? null,
        advisor: a.service_reception?.trim() || null,
        source: a.source,
        arrived: came.has(a.id),
      }));
    }
    case "technician_claims": {
      let q = createAdminClient()
        .from("self_audit_tech_claims")
        .select("claim_no, branch_id, technician_name, work_order, status, submitted_at, reviewed_at, reviewed_by_name, times_submitted, prior_approval, defective_part_received, created_at")
        .order("created_at", { ascending: false })
        .limit(10000);
      if (au.branchId) q = q.eq("branch_id", au.branchId);
      const [{ data }, names] = await Promise.all([q, branchNames()]);
      return (data ?? []).map((c) => ({
        claim_no: c.claim_no,
        branch: names.get(c.branch_id) ?? null,
        technician: c.technician_name,
        work_order: c.work_order,
        status: c.status,
        submitted: day(c.submitted_at),
        reviewed: day(c.reviewed_at),
        reviewed_by: c.reviewed_by_name,
        times_submitted: c.times_submitted,
        prior_approval: c.prior_approval,
        defective_part_received: c.defective_part_received,
        created: day(c.created_at),
      }));
    }
  }
}

/** Warranty KPIs for a period of months (YYYY-MM), per branch and in total - the same figures as the KPI dashboard. */
export async function warrantyKpis(au: AssistantUser, from?: string, to?: string) {
  const range = resolveMonthRange({ from, to });
  const { data: all } = await createAdminClient().from("self_audit_branches").select("id, name").eq("active", true).order("name");
  const branches = (all ?? []).filter((b) => !au.branchId || b.id === au.branchId);
  const data = await getDashboardData(createAdminClient(), { branches, from: range.from, to: range.to }, getCachedClaimSide(branches, range.from, range.to));
  const pick = (r: Record<string, unknown>) => ({
    claims: r.claimCount,
    claim_amount_sar: r.totalClaimAmount,
    adjusted_amount_sar: r.totalAdjustedAmount,
    submitted: r.submittedCount,
    accepted_first_time: r.acceptedFirstTime,
    claims_per_wip: r.claimsPerWip,
    avg_repair_completion_days: r.avgRepairCompletionDays,
    avg_claim_submission_days: r.avgClaimSubmissionDays,
    warranty_room_parts: r.warrantyRoomParts,
    flagged_to_scrap: r.flaggedToScrap,
  });
  return {
    period: `${range.from} to ${range.to}`,
    clamped: range.clamped,
    totals: pick(data.totals as unknown as Record<string, unknown>),
    branches: data.branchRows.map((b) => ({ branch: b.name, ...pick(b as unknown as Record<string, unknown>) })),
  };
}

/** Everything about one WIP, VIN, plate or claim number (the portal's Query page). */
export async function lookup(input: string) {
  const r = await vehicleQuery(input);
  const text = JSON.stringify(r);
  return text.length > 14_000 ? `${text.slice(0, 14_000)}… (cut - ask about one part for more)` : text;
}
