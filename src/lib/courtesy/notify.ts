import "server-only";
import type { CurrentUser } from "@/lib/auth";
import { agreementsTable } from "./agreements-server";
import { loadFleet } from "./fleet-server";

export type CourtesyNote = { id: string; kind: "courtesy"; title: string; detail: string; href: string; at: string };

/**
 * The bell's courtesy car items:
 *  - an advisor: his own loans past the agreement expiry;
 *  - a reception manager / warranty admin: the branch's cars due (or within 1,000 km of) their 10,000 km service,
 *    overdue loans, and transfers to send or receive;
 *  - a warranty officer: the same for every branch (service due now and overdue loans only).
 * Never throws (the bell must not break a page).
 */
export async function courtesyNotes(user: CurrentUser, area: "admin" | "audit" | "advisor"): Promise<CourtesyNote[]> {
  try {
    const base = `/${area}/courtesy-cars`;
    const officer = user.role === "officer";
    const manager = officer || user.queue_role === "manager" || user.role === "branch_admin";
    const branchId = officer ? null : user.branch_id;
    if (!officer && !branchId) return [];
    const now = Date.now();
    const notes: CourtesyNote[] = [];

    let q = agreementsTable().select("id, ref, customer_name, vehicle_label, expires_at, advisor_id, handed_over_by").eq("status", "open").lt("expires_at", new Date(now).toISOString());
    if (branchId) q = q.eq("branch_id", branchId);
    const { data: late } = await q;
    for (const a of (late ?? []) as { id: string; ref: string; customer_name: string; vehicle_label: string | null; expires_at: string; advisor_id: string | null; handed_over_by: string | null }[]) {
      if (!manager && a.advisor_id !== user.id && a.handed_over_by !== user.id) continue;
      notes.push({ id: `cc-late:${a.id}`, kind: "courtesy", title: `Courtesy car overdue: ${a.vehicle_label ?? a.ref}`, detail: `${a.customer_name} - ${Math.ceil((now - new Date(a.expires_at).getTime()) / 86_400_000)} day(s) past the agreement expiry`, href: `${base}/${a.id}`, at: a.expires_at });
    }
    if (!manager) return notes;

    const { rows, branches } = await loadFleet(branchId);
    const name = new Map(branches.map((b) => [b.id, b.name]));
    for (const r of rows) {
      if (r.service.state === "due" || (!officer && r.service.state === "soon"))
        notes.push({
          id: `cc-service:${r.id}:${r.service.nextKm}`,
          kind: "courtesy",
          title: `${r.service.state === "due" ? "Service due" : "Service soon"}: ${r.plate}${officer && r.branchName ? ` (${r.branchName})` : ""}`,
          detail: `${r.km?.toLocaleString("en-US")} km - service at ${r.service.nextKm?.toLocaleString("en-US")} km (every 10,000 km)`,
          href: `${base}/vehicle/${r.id}`,
          at: r.updated_at,
        });
      if (r.transfer && !officer) {
        if (r.transfer.status === "requested" && r.transfer.from_branch === branchId)
          notes.push({ id: `cc-send:${r.transfer.id}`, kind: "courtesy", title: `Transfer ${r.plate} to ${name.get(r.transfer.to_branch)}`, detail: `${r.transfer.requested_by_name ?? "Head office"}${r.transfer.reason ? `: ${r.transfer.reason}` : ""} - mark it sent when it leaves`, href: `${base}/vehicle/${r.id}`, at: r.transfer.requested_at });
        if (r.transfer.status === "sent" && r.transfer.to_branch === branchId)
          notes.push({ id: `cc-recv:${r.transfer.id}`, kind: "courtesy", title: `Courtesy car on its way: ${r.plate}`, detail: `From ${name.get(r.transfer.from_branch)} - mark it received when it arrives`, href: `${base}/vehicle/${r.id}`, at: r.transfer.sent_at ?? r.transfer.requested_at });
      }
    }
    return notes.slice(0, 20);
  } catch {
    return [];
  }
}
