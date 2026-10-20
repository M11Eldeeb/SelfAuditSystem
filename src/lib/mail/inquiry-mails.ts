import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { findSentMail, getMailStatus } from "@/lib/gmail";
import { composeMail, type MailKey } from "@/lib/mail/catalog";
import { loadPeople, loadTemplates, recipientsFor } from "@/lib/mail/people";
import { isMailEnabled, sendPlans, type PlannedMail, type SendOutcome } from "@/lib/mail/plans";
import { RESPONSIBLE_ROLE_LABEL, SUBMIT_REASON_LABEL, SYSTEM_LABEL, VEHICLE_LOCATION_LABEL, inquiryLabel, type InquirySystem, type VehicleLocation } from "@/lib/technical-inquiries";

/**
 * The e-mails of Technical Inquiries. Each event on a case sends one mail, to the other side:
 *   the workshop submits / replies / sends it again / cancels  ->  the technical team
 *   the technical team replies / closes / reopens              ->  the workshop (its admins), with the service manager,
 *                                                                  workshop supervisor and team leader copied
 * Two switches (Settings -> Email settings) turn the two directions on; both start off. The wording, copies and extra
 * addresses are editable like every other mail. A mail is never sent twice for the same event, and the mails of one
 * side of a case form one thread.
 */

export type InquiryEvent = "created" | "workshop_reply" | "resubmitted" | "cancelled" | "delegated" | "team_reply" | "closed" | "reopened" | "needs_verification" | "verified" | "rejected" | "returned";

const MAIL_FOR: Record<InquiryEvent, MailKey> = {
  created: "inquiry_new",
  workshop_reply: "inquiry_reply",
  resubmitted: "inquiry_resubmitted",
  cancelled: "inquiry_cancelled",
  delegated: "inquiry_delegated",
  needs_verification: "inquiry_verify",
  verified: "inquiry_new",
  rejected: "inquiry_rejected",
  // Returned to complete documents / diagnosis: the same "sent back by the supervisor" mail, with what is missing.
  returned: "inquiry_rejected",
  team_reply: "inquiry_answered",
  closed: "inquiry_closed",
  reopened: "inquiry_reopened",
};
/** The comment row an event leaves behind (the "created" event has none). */
const COMMENT_KIND: Partial<Record<InquiryEvent, "comment" | "closed" | "reopened" | "cancelled" | "resubmitted" | "assigned" | "verified" | "rejected" | "returned">> = {
  workshop_reply: "comment",
  team_reply: "comment",
  resubmitted: "resubmitted",
  cancelled: "cancelled",
  delegated: "assigned",
  verified: "verified",
  rejected: "rejected",
  returned: "returned",
  closed: "closed",
  reopened: "reopened",
};
const TO_TECHNICAL = new Set<InquiryEvent>(["created", "workshop_reply", "resubmitted", "cancelled", "delegated", "verified"]);

export const INQUIRY_SWITCH = { technical: "inquiry_mails_technical", workshop: "inquiry_mails_workshop" } as const;

const clip = (text: string | null | undefined, max: number) => {
  const t = (text ?? "").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export async function planInquiryMail(event: InquiryEvent, inquiryId: string, origin: string): Promise<PlannedMail[]> {
  const admin = createAdminClient();
  const { data: inquiry } = await admin.from("self_audit_technical_inquiries").select("*").eq("id", inquiryId).maybeSingle();
  if (!inquiry) return [];
  const toTechnical = TO_TECHNICAL.has(event);
  const side = toTechnical ? "technical" : "workshop";
  const mailKey = MAIL_FOR[event];

  // The comment this event wrote (a reply, the reason, the solution...): the newest of its kind.
  let comment: { id: string; body: string | null; author_name: string | null } | null = null;
  const kind = COMMENT_KIND[event];
  if (kind) {
    let q = admin.from("self_audit_technical_inquiry_comments").select("id, body, author_name, author_role").eq("inquiry_id", inquiryId).eq("kind", kind).eq("internal", false);
    if (event === "workshop_reply") q = q.in("author_role", ["branch_admin", "workshop_supervisor", "team_leader"]);
    if (event === "team_reply") q = q.not("author_role", "in", "(branch_admin,workshop_supervisor,team_leader)");
    const { data } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
    comment = data;
    if (!comment) return [];
  }

  const [people, templates, { data: branch }] = await Promise.all([
    loadPeople(),
    loadTemplates(),
    admin.from("self_audit_branches").select("name, active").eq("id", inquiry.branch_id).maybeSingle(),
  ]);
  const t = templates[mailKey];
  const branchName = branch?.name ?? "Branch";

  // To: the assigned technical advisor, else the whole technical team, else (nobody is set up yet) the officers.
  // Or, for the workshop, the branch's admins - a closed branch gets nothing.
  let to: string[];
  let path: string;
  if (toTechnical) {
    let assignedEmail: string | null = null;
    if (inquiry.assigned_to) {
      const { data: u } = await admin.from("self_audit_users").select("email").eq("id", inquiry.assigned_to).maybeSingle();
      assignedEmail = u?.email?.toLowerCase() ?? null;
    }
    to = assignedEmail ? [assignedEmail] : people.technical.length ? people.technical : people.officers;
    path = "/technical-inquiries";
  } else {
    if (branch?.active === false) to = [];
    else if (event === "needs_verification") to = people.supervisorAccountsByBranch.get(inquiry.branch_id)?.length ? (people.supervisorAccountsByBranch.get(inquiry.branch_id) ?? []) : (people.adminsByBranch.get(inquiry.branch_id) ?? []);
    else {
      const { data: creator } = inquiry.created_by ? await admin.from("self_audit_users").select("email").eq("id", inquiry.created_by).maybeSingle() : { data: null };
      to = event === "rejected" || event === "returned"
        ? [creator?.email?.toLowerCase() ?? ""].filter(Boolean)
        : [...new Set([...(people.adminsByBranch.get(inquiry.branch_id) ?? []), ...(people.supervisorAccountsByBranch.get(inquiry.branch_id) ?? []), creator?.email?.toLowerCase() ?? ""].filter(Boolean))];
    }
    path = "/technical-inquiries";
  }

  const by = comment?.author_name ?? (event === "created" || event === "needs_verification" ? inquiry.created_by_name : null) ?? (toTechnical ? "The workshop" : "The technical team");
  const mail = composeMail(t, {
    number: inquiryLabel(inquiry.inquiry_no),
    branch: branchName,
    work_order: inquiry.work_order_no,
    vin: inquiry.vin,
    reasons: inquiry.submit_reasons.map((r) => SUBMIT_REASON_LABEL[r] ?? r).join("; "),
    plate: inquiry.plate_number,
    mileage: `${inquiry.mileage_km.toLocaleString("en-US")} km`,
    escalated_by: `${inquiry.responsible_name} (${RESPONSIBLE_ROLE_LABEL[inquiry.responsible_role] ?? inquiry.responsible_role})`,
    model: inquiry.vehicle_model,
    system: SYSTEM_LABEL[inquiry.system as InquirySystem] ?? inquiry.system,
    car_location: VEHICLE_LOCATION_LABEL[inquiry.vehicle_location as VehicleLocation] ?? inquiry.vehicle_location,
    in_workshop: inquiry.vehicle_location === "in_workshop" ? "CAR IN WORKSHOP - " : "",
    advisor: inquiry.assigned_to_name ?? "Not assigned yet",
    by,
    submitted_by: inquiry.created_by_name ?? "colleague",
    fault: clip(inquiry.fault_complaint, 400),
    comment: clip(comment?.body, 800),
    resolution: clip(inquiry.resolution, 1200),
    link: `${origin}${path}/${inquiry.id}`,
  });

  // A mail for "waiting for verification" has no comment of its own: it is keyed by the moment the case last changed.
  const key = `inquiry:${inquiry.id}:${side}:${event === "needs_verification" ? `verify-${Date.parse(inquiry.updated_at)}` : (comment?.id ?? "created")}`;
  // The mails of one side of a case share a thread: the first one that went out is the original.
  const { data: first } = await admin
    .from("self_audit_email_log")
    .select("dedupe_key")
    .like("dedupe_key", `inquiry:${inquiry.id}:${side}:%`)
    .eq("status", "sent")
    .order("sent_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const original = first?.dedupe_key && first.dedupe_key !== key ? await findSentMail(first.dedupe_key) : null;

  return [
    {
      kind: `inquiry-${side}`,
      key,
      branchId: inquiry.branch_id,
      branchName,
      ...recipientsFor(t, people, { to, branchId: inquiry.branch_id }),
      ...mail,
      subject: original ? `Re: ${original.subject}` : mail.subject,
      replyToKey: original && first?.dedupe_key ? first.dedupe_key : undefined,
      label: `${inquiryLabel(inquiry.inquiry_no)} - ${event.replace("_", " ")}`,
    },
  ];
}

/**
 * Sends the mail for one event, if the e-mail sender is connected and the switch of that direction is on.
 * Never throws - a mail problem must not undo a case that is already saved.
 */
export async function notifyInquiry(event: InquiryEvent, inquiryId: string, origin: string): Promise<SendOutcome[]> {
  try {
    const side = TO_TECHNICAL.has(event) ? "technical" : "workshop";
    if (!(await getMailStatus()) || !(await isMailEnabled(INQUIRY_SWITCH[side]))) return [];
    return await sendPlans(await planInquiryMail(event, inquiryId, origin), null);
  } catch (e) {
    console.error("Technical inquiry mail failed:", e instanceof Error ? e.message : e);
    return [];
  }
}
