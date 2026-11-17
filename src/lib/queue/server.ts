import "server-only";
import webpush from "web-push";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_SETTINGS, fullOrder, type QueueSettings } from "@/lib/queue/core";

/**
 * Who may do what in the customer queue.
 * - role "advisor": calls service customers of his branch; "parts_advisor": spare parts customers of his branch;
 *   "manager": runs his branch's queue (both lists, assigning, settings, TV). A manager without a branch (head office),
 *   a warranty officer, a national manager or a manager account: every branch, as a manager.
 * - `admin`: the warranty officers - queue admin (branch codes, who has queue access, the account import, the team list).
 */
export type QueueAccess = {
  user: CurrentUser;
  role: "advisor" | "parts_advisor" | "manager";
  allBranches: boolean;
  branchId: string | null;
  admin: boolean;
};

export async function getQueueAccess(): Promise<QueueAccess | null> {
  const user = await getCurrentUser();
  if (!user || user.must_change_password) return null;
  const hq = user.role === "officer" || user.role === "national_manager" || user.role === "manager";
  if (hq) return { user, role: "manager", allBranches: true, branchId: user.branch_id, admin: user.role === "officer" };
  if (!user.queue_role) return null;
  const allBranches = user.queue_role === "manager" && !user.branch_id;
  return { user, role: user.queue_role, allBranches, branchId: user.branch_id, admin: false };
}

export type QueueBranch = { id: string; name: string; name_ar: string | null; queue_code: string; queue_status: "open" | "paused" | "closed" };

export async function queueBranches(): Promise<QueueBranch[]> {
  const { data } = await createAdminClient()
    .from("self_audit_branches")
    .select("id, name, name_ar, queue_code, queue_status")
    .eq("active", true)
    .not("queue_code", "is", null)
    .order("name");
  return (data ?? []) as QueueBranch[];
}

export async function branchByCode(code: string): Promise<QueueBranch | null> {
  const clean = String(code ?? "").trim().toUpperCase();
  if (!clean) return null;
  const { data } = await createAdminClient()
    .from("self_audit_branches")
    .select("id, name, name_ar, queue_code, queue_status, active")
    .ilike("queue_code", clean.replace(/[%_]/g, ""))
    .maybeSingle();
  return data && data.active && data.queue_code ? (data as QueueBranch) : null;
}

/** May this person work in this branch's queue? */
export const canUseBranch = (a: QueueAccess, branchId: string) => a.allBranches || a.branchId === branchId;

export async function branchSettings(branchId: string): Promise<QueueSettings> {
  const { data } = await createAdminClient().from("self_audit_queue_settings").select("*").eq("branch_id", branchId).maybeSingle();
  if (!data) return DEFAULT_SETTINGS;
  return { priority_order: fullOrder(data.priority_order), fairness_enabled: data.fairness_enabled, fairness_override_minutes: data.fairness_override_minutes };
}

// ---------- the customer's "your turn" alert (browser push) ----------

export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY ?? "";

let vapidReady: boolean | null = null;
function vapid(): boolean {
  if (vapidReady != null) return vapidReady;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return (vapidReady = false);
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:warranty@jiadmotors.com", pub, priv);
  return (vapidReady = true);
}

/** Sends "It's your turn" to every phone that asked for alerts on this ticket. Never throws. */
export async function pushTurnAlert(ticketId: string): Promise<void> {
  try {
    if (!vapid()) return;
    const admin = createAdminClient();
    const [{ data: tk }, { data: subs }] = await Promise.all([
      admin.from("self_audit_queue_tickets").select("ticket_number, advisor_name").eq("id", ticketId).maybeSingle(),
      admin.from("self_audit_queue_push").select("id, endpoint, p256dh, auth").eq("ticket_id", ticketId),
    ]);
    if (!tk || !subs?.length) return;
    const payload = JSON.stringify({
      title: "It's your turn! · حان دورك!",
      body: `${tk.ticket_number ?? ""} - ${tk.advisor_name ? `${tk.advisor_name} is ready for you · بانتظارك` : "Please proceed now · يرجى التوجه الآن"}`,
      url: `/q/t/${ticketId}`,
      tag: `queue-${ticketId}`,
    });
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 600, urgency: "high" });
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) await admin.from("self_audit_queue_push").delete().eq("id", s.id);
        }
      })
    );
  } catch {
    // an alert that could not be sent never blocks calling the customer
  }
}
