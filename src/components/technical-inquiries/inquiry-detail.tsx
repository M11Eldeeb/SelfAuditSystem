import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDriveStatus } from "@/lib/google-drive";
import {
  AFTER_REPAIR_LABEL,
  CATEGORY_LABEL,
  OCCURRENCE_CONDITION_LABEL,
  OCCURRENCE_LABEL,
  RESPONSIBLE_ROLE_LABEL,
  ROLE_LABEL,
  SUBMIT_REASON_LABEL,
  STATUS_BADGE,
  STATUS_LABEL,
  SYSTEM_LABEL,
  VEHICLE_LOCATION_LABEL,
  basePathFor,
  canVerifyRole,
  isWorkshopRole,
  driveFileUrl,
  driveFolderUrl,
  durationText,
  type AttachmentCategory,
  formatMileage,
  inquiryLabel,
  isLate,
  waitingText,
  type VehicleLocation,
  type InquiryRole,
  type InquiryStatus,
  type InquirySystem,
} from "@/lib/technical-inquiries";
import { formatBytes } from "@/lib/feedback-constants";
import { InquiryCommentForm } from "./comment-form";
import { ClosePanel } from "./close-panel";
import { AssignPanel, ReturnedPanel, TeamReturnPanel, VerifyPanel, WorkshopActions } from "./case-actions";
import { EditableCase } from "./edit-case";

const stamp = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" });

type Attachment = { id: string; comment_id: string | null; drive_file_id: string; file_name: string; mime_type: string; size_bytes: number; category: AttachmentCategory; wip_id: string | null; step_no: number | null };

const EVENT_LABEL: Record<string, string> = {
  closed: "Case closed",
  reopened: "Case reopened",
  cancelled: "Case cancelled",
  verified: "Verified by the workshop supervisor - sent to the technical team",
  rejected: "Rejected by the workshop supervisor",
  returned: "Returned to complete documents / diagnosis",
  sent_to_supervisor: "Completed and sent to the workshop supervisor again",
  edited: "Case details edited",
  resubmitted: "Case sent again",
  assigned: "Case assigned",
};

function Files({ files }: { files: Attachment[] }) {
  if (files.length === 0) return null;
  return (
    <ul className="space-y-1">
      {files.map((f) => (
        <li key={f.id} className="flex flex-wrap items-center gap-x-2 text-sm">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0 text-neutral-400">
            <path d="M15.5 9.5l-5.6 5.6a3.5 3.5 0 01-5-5l6-6a2.3 2.3 0 013.3 3.3l-6 6a1.2 1.2 0 01-1.7-1.7l5.4-5.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <a href={driveFileUrl(f.drive_file_id)} target="_blank" rel="noreferrer" className="min-w-0 truncate font-medium text-brand hover:underline">
            {f.file_name}
          </a>
          <span className="text-xs text-neutral-500">{formatBytes(f.size_bytes)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The fields kept in each saved version, with their labels (for "Edit history"). */
const VERSION_FIELDS: [string, string][] = [
  ["vin", "VIN"],
  ["plate_number", "Plate number"],
  ["vehicle_model", "Vehicle model"],
  ["system", "System"],
  ["vehicle_location", "Where is the car"],
  ["mileage_km", "Mileage"],
  ["dtc_codes", "Fault codes"],
  ["software_version", "Software version"],
  ["occurrence", "Permanent / intermittent"],
  ["occurrence_conditions", "Other condition"],
  ["concern_first_noticed", "First noticed"],
  ["after_previous_repair", "After a previous repair"],
  ["previous_repair_details", "Previous repair details"],
  ["fault_complaint", "Customer concern"],
  ["parts_replaced", "Parts already replaced"],
  ["responsible_phone", "Phone"],
  ["workshop_comments", "Comments of the workshop"],
];
const show = (v: unknown) => (v == null || v === "" ? "—" : Array.isArray(v) ? v.join(", ") : String(v));

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-neutral-500">{label}</dt>
      <dd className="font-medium text-neutral-900">{children}</dd>
    </div>
  );
}

/** One inquiry: the case details, the files (in Google Drive), the conversation, and what this role can do about it. */
export async function InquiryDetail({ role, id, reply = false }: { role: InquiryRole; id: string; reply?: boolean }) {
  const supabase = await createClient();
  const basePath = basePathFor(role);
  const isTeam = role === "technical" || role === "officer";

  // "Edit & Reply": the technical advisor takes the case if nobody has it yet (the database does nothing for a case that has one).
  // Just viewing a case assigns nothing.
  if (role === "technical" && reply) await supabase.rpc("claim_technical_inquiry", { p_inquiry_id: id });

  // RLS decides what the caller may see: a branch admin gets nothing for another branch's case.
  const { data: inquiry } = await supabase.from("self_audit_technical_inquiries").select("*").eq("id", id).maybeSingle();
  if (!inquiry) notFound();

  const [user, { data: branch }, { data: comments }, { data: attachmentRows }, { data: wipRows }, drive, { data: folder }, { data: techRows }, { data: versionRows }] = await Promise.all([
    getCurrentUser(),
    supabase.from("self_audit_branches").select("name").eq("id", inquiry.branch_id).maybeSingle(),
    // Internal notes come back only for the technical team and officers (the database hides them from the workshop).
    supabase.from("self_audit_technical_inquiry_comments").select("*").eq("inquiry_id", id).order("created_at"),
    supabase.from("self_audit_technical_inquiry_attachments").select("*").eq("inquiry_id", id).order("created_at"),
    supabase.from("self_audit_inquiry_work_orders").select("*").eq("inquiry_id", id).order("position"),
    getDriveStatus(),
    createAdminClient().from("self_audit_drive_folders").select("drive_id").eq("key", `inquiry:case:${id}`).maybeSingle(),
    isTeam ? createAdminClient().from("self_audit_users").select("id, full_name, email").eq("role", "technical").order("full_name") : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string }[] }),
    // The versions before each edit: the technical team and officers see what the case said before it was changed.
    isTeam
      ? supabase.from("self_audit_technical_inquiry_versions").select("version_no, snapshot, edited_by_name, edited_role, edited_at").eq("inquiry_id", id).order("version_no")
      : Promise.resolve({ data: [] as { version_no: number; snapshot: Record<string, unknown>; edited_by_name: string | null; edited_role: string | null; edited_at: string }[] }),
  ]);
  const attachments = (attachmentRows ?? []) as Attachment[];
  const caseFiles = attachments.filter((a) => a.comment_id === null && a.wip_id === null);
  const workOrders = wipRows ?? [];
  const caseFileGroups = (["concern_media", "vehicle_history", "other"] as AttachmentCategory[])
    .map((category) => ({ category, files: caseFiles.filter((f) => f.category === category) }))
    .filter((g) => g.files.length > 0);
  const status = inquiry.status as InquiryStatus;
  const closed = status === "closed";
  const awaitingVerification = status === "pending_verification";
  const cancelled = status === "cancelled";
  const returned = status === "returned";
  const returnedByTeam = returned && inquiry.returned_by === "technical";
  const rejected = status === "rejected";
  const finished = closed || cancelled || rejected;
  const withSupervisor = awaitingVerification || (returned && !returnedByTeam);
  // The technical team works on a case (reply, return, close - not edit its details) after "Edit & Reply" or when it is theirs;
  // officers always can.
  const working = role === "officer" || (role === "technical" && (reply || inquiry.assigned_to === user?.id));
  // Who may edit: officers and the branch's supervisor / admin while the case is not finished; the team leader on his own case
  // while it waits for, or was returned by, the supervisor (the database checks the same).
  const canEdit =
    !finished &&
    (role === "officer" ||
      role === "workshop_supervisor" ||
      role === "branch_admin" ||
      (role === "team_leader" && inquiry.created_by === user?.id && (withSupervisor || returnedByTeam)));
  const lastReturn = [...(comments ?? [])].reverse().find((c) => c.kind === "returned");
  const versions = versionRows ?? [];
  const editInitial = {
            vin: inquiry.vin,
            plate_number: inquiry.plate_number,
            vehicle_model: inquiry.vehicle_model,
            system: inquiry.system,
            vehicle_location: inquiry.vehicle_location,
            mileage_km: inquiry.mileage_km,
            dtc_codes: inquiry.dtc_codes ?? "",
            software_version: inquiry.software_version ?? "",
            occurrence: inquiry.occurrence,
            occurrence_conditions: inquiry.occurrence_conditions ?? "",
            parts_replaced: inquiry.parts_replaced ?? "",
            responsible_phone: inquiry.responsible_phone ?? "",
            concern_first_noticed: inquiry.concern_first_noticed,
            after_previous_repair: inquiry.after_previous_repair,
            previous_repair_details: inquiry.previous_repair_details ?? "",
            fault_complaint: inquiry.fault_complaint,
            workshop_comments: inquiry.workshop_comments ?? "",
          };
  const current: Record<string, unknown> = { ...inquiry };
  const late = isLate(inquiry.waiting_since, status);
  const technicians = (techRows ?? []).map((t) => ({ id: t.id, name: t.full_name?.trim() || t.email }));
  const timeToFirstAnswer = inquiry.first_response_at ? new Date(inquiry.first_response_at).getTime() - new Date(inquiry.created_at).getTime() : null;
  const timeToClose = inquiry.closed_at ? new Date(inquiry.closed_at).getTime() - new Date(inquiry.created_at).getTime() : null;
  const occurrenceWhen = inquiry.occurrence_keys.map((k) => (k === "other" && inquiry.occurrence_conditions ? `Other: ${inquiry.occurrence_conditions}` : (OCCURRENCE_CONDITION_LABEL[k] ?? k))).join("; ");

  return (
    <div className="space-y-6">
      <div>
        <Link href={basePath} className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to the inquiries
        </Link>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{inquiryLabel(inquiry.inquiry_no)}</h1>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_BADGE[status]}`}>{STATUS_LABEL[status]}</span>
          {inquiry.vehicle_location === "in_workshop" && <span className="rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-semibold text-white">CAR IN WORKSHOP</span>}
          {!isWorkshopRole(role) && branch?.name && (
            <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-700 ring-1 ring-neutral-200 ring-inset">{branch.name}</span>
          )}
          <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-700 ring-1 ring-neutral-200 ring-inset">{SYSTEM_LABEL[inquiry.system as InquirySystem] ?? inquiry.system}</span>
          {inquiry.waiting_since && !finished && (
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${late ? "bg-red-50 text-red-700 ring-red-200" : "bg-neutral-50 text-neutral-600 ring-neutral-200"}`}>
              {status === "open" ? "Waiting for the technical team" : "Waiting for the workshop"} {waitingText(inquiry.waiting_since)}
            </span>
          )}
        </div>
      </div>

      {(() => {
        const caseView = (
          <>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Work order">{inquiry.work_order_no}</Fact>
          <Fact label="VIN">
            <span className="font-mono text-[13px] break-all">{inquiry.vin}</span>
          </Fact>
          <Fact label="Plate number">{inquiry.plate_number}</Fact>
          <Fact label="Vehicle model">{inquiry.vehicle_model}</Fact>
          <Fact label="Escalated by">
            {inquiry.responsible_name}
            <span className="block text-xs font-normal text-neutral-500">
              {RESPONSIBLE_ROLE_LABEL[inquiry.responsible_role] ?? inquiry.responsible_role}
              {inquiry.responsible_phone ? ` · ${inquiry.responsible_phone}` : ""}
            </span>
          </Fact>
          <Fact label="Submitted by">
            {inquiry.created_by_name ?? "—"}
            <span className="block text-xs font-normal text-neutral-500">{stamp(inquiry.created_at)}</span>
          </Fact>
          <Fact label="The car">{VEHICLE_LOCATION_LABEL[inquiry.vehicle_location as VehicleLocation] ?? inquiry.vehicle_location}</Fact>
          <Fact label="Mileage">{formatMileage(inquiry.mileage_km)}</Fact>
          {inquiry.software_version && <Fact label="Software / ECU version">{inquiry.software_version}</Fact>}
          {inquiry.dtc_codes && (
            <Fact label="Fault codes (DTC)">
              <span className="font-mono text-[13px] break-words">{inquiry.dtc_codes}</span>
            </Fact>
          )}
          <Fact label={`Happens ${inquiry.occurrence === "permanent" ? "permanently" : "intermittently"} when`}>
            <span className="text-[13px] font-medium">{occurrenceWhen}</span>
            <span className="block text-xs font-normal text-neutral-500">{OCCURRENCE_LABEL[inquiry.occurrence] ?? inquiry.occurrence}</span>
          </Fact>
          <Fact label="First noticed by the customer">{inquiry.concern_first_noticed}</Fact>
          <Fact label="Related to a previous repair">
            {AFTER_REPAIR_LABEL[inquiry.after_previous_repair]?.split(" - ")[0] ?? inquiry.after_previous_repair}
            {inquiry.previous_repair_details && <span className="block text-xs font-normal whitespace-pre-wrap text-neutral-500">{inquiry.previous_repair_details}</span>}
          </Fact>
          {inquiry.verified_by_name && (
            <Fact label="Verified by">
              {inquiry.verified_by_name}
              {inquiry.verified_at && <span className="block text-xs font-normal text-neutral-500">{stamp(inquiry.verified_at)}</span>}
            </Fact>
          )}
          <Fact label="Technical advisor">{inquiry.assigned_to_name ?? <span className="font-normal text-neutral-500">Not assigned yet</span>}</Fact>
          {timeToFirstAnswer != null && <Fact label="First answer after">{durationText(timeToFirstAnswer)}</Fact>}
          {timeToClose != null && <Fact label="Solved in">{durationText(timeToClose)}</Fact>}
        </dl>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-neutral-500">Sent to the technical team because</span>
          {inquiry.submit_reasons.map((r) => (
            <span key={r} className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-800 ring-1 ring-neutral-200 ring-inset">
              {SUBMIT_REASON_LABEL[r] ?? r}
            </span>
          ))}
        </div>
        {inquiry.parts_replaced && (
          <div>
            <p className="text-xs font-medium text-neutral-500">Parts already replaced</p>
            <p className="mt-1 text-sm whitespace-pre-wrap text-neutral-900">{inquiry.parts_replaced}</p>
          </div>
        )}
        <div>
          <p className="text-xs font-medium text-neutral-500">Customer concern</p>
          <p className="mt-1 text-sm whitespace-pre-wrap text-neutral-900">{inquiry.fault_complaint}</p>
        </div>
        {workOrders.map((w) => {
          const mine = attachments.filter((f) => f.wip_id === w.id);
          const docs: AttachmentCategory[] = ["vds_report", "work_order_photo", "agreement_photo"];
          return (
            <div key={w.id} className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50/60 p-4">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-neutral-900">
                Workshop effort - {w.work_order_no}
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-600 ring-1 ring-neutral-200 ring-inset">{w.position === 0 ? "current work order" : "previous work order"}</span>
              </p>
              {w.previous_concern && (
                <div>
                  <p className="text-xs font-medium text-neutral-500">Customer previous concern</p>
                  <p className="mt-1 text-sm whitespace-pre-wrap text-neutral-900">{w.previous_concern}</p>
                </div>
              )}
              <ol className="space-y-2.5">
                {w.steps.map((step, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-neutral-900">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[11px] font-bold text-brand">{i + 1}</span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="whitespace-pre-wrap">{step}</p>
                      <Files files={mine.filter((f) => f.category === "workshop_effort" && f.step_no === i + 1)} />
                    </div>
                  </li>
                ))}
              </ol>
              <div className="grid gap-3 border-t border-neutral-200 pt-3 sm:grid-cols-3">
                {docs.map((cat) => (
                  <div key={cat}>
                    <p className="mb-1 text-xs font-medium text-neutral-500">{CATEGORY_LABEL[cat]}</p>
                    <Files files={mine.filter((f) => f.category === cat)} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {inquiry.workshop_comments && (
          <div>
            <p className="text-xs font-medium text-neutral-500">Comments of the workshop</p>
            <p className="mt-1 text-sm whitespace-pre-wrap text-neutral-900">{inquiry.workshop_comments}</p>
          </div>
        )}
        {caseFileGroups.map((g) => (
          <div key={g.category}>
            <p className="mb-1 text-xs font-medium text-neutral-500">{CATEGORY_LABEL[g.category]}</p>
            <Files files={g.files} />
          </div>
        ))}
          </>
        );
        const caseFixed = (
          <>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-neutral-500">Sent to the technical team because</span>
          {inquiry.submit_reasons.map((r) => (
            <span key={r} className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-800 ring-1 ring-neutral-200 ring-inset">
              {SUBMIT_REASON_LABEL[r] ?? r}
            </span>
          ))}
        </div>
        {workOrders.map((w) => {
          const mine = attachments.filter((f) => f.wip_id === w.id);
          const docs: AttachmentCategory[] = ["vds_report", "work_order_photo", "agreement_photo"];
          return (
            <div key={w.id} className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50/60 p-4">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-neutral-900">
                Workshop effort - {w.work_order_no}
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-600 ring-1 ring-neutral-200 ring-inset">{w.position === 0 ? "current work order" : "previous work order"}</span>
              </p>
              {w.previous_concern && (
                <div>
                  <p className="text-xs font-medium text-neutral-500">Customer previous concern</p>
                  <p className="mt-1 text-sm whitespace-pre-wrap text-neutral-900">{w.previous_concern}</p>
                </div>
              )}
              <ol className="space-y-2.5">
                {w.steps.map((step, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-neutral-900">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[11px] font-bold text-brand">{i + 1}</span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="whitespace-pre-wrap">{step}</p>
                      <Files files={mine.filter((f) => f.category === "workshop_effort" && f.step_no === i + 1)} />
                    </div>
                  </li>
                ))}
              </ol>
              <div className="grid gap-3 border-t border-neutral-200 pt-3 sm:grid-cols-3">
                {docs.map((cat) => (
                  <div key={cat}>
                    <p className="mb-1 text-xs font-medium text-neutral-500">{CATEGORY_LABEL[cat]}</p>
                    <Files files={mine.filter((f) => f.category === cat)} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {caseFileGroups.map((g) => (
          <div key={g.category}>
            <p className="mb-1 text-xs font-medium text-neutral-500">{CATEGORY_LABEL[g.category]}</p>
            <Files files={g.files} />
          </div>
        ))}
          </>
        );
        return canEdit ? (
          <EditableCase
            inquiryId={inquiry.id}
            highlight={returned && role === "team_leader"}
            view={caseView}
            fixed={caseFixed}
            initial={editInitial}
          />
        ) : (
          <section className="space-y-4 rounded-xl border border-neutral-200/70 bg-white p-5 shadow-sm">{caseView}</section>
        );
      })()}

      {folder && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200/70 bg-white px-4 py-3 shadow-sm">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-neutral-900">Photos, videos and documents</p>
            <p className="text-xs text-neutral-500">
              {attachments.length === 0 ? "Nothing has been attached yet." : `${attachments.length} file${attachments.length === 1 ? "" : "s"} in this case's Google Drive folder.`}
              {inquiry.pdf_drive_file_id ? " The case report (PDF) is in the same folder." : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {inquiry.pdf_drive_file_id && (
              <a
                href={driveFileUrl(inquiry.pdf_drive_file_id)}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-sm font-semibold text-neutral-800 shadow-sm transition-colors hover:bg-neutral-50"
              >
                Case report (PDF)
              </a>
            )}
            <a
              href={driveFolderUrl(folder.drive_id)}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-dark"
            >
              Open on Google Drive
            </a>
          </div>
        </section>
      )}

      {awaitingVerification && <VerifyPanel inquiryId={inquiry.id} canVerify={canVerifyRole(role)} submittedBy={inquiry.created_by_name} />}
      {role === "technical" && !working && !finished && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 shadow-sm">
          <div>
            <p className="text-sm font-semibold text-sky-950">You are viewing this case</p>
            <p className="text-xs text-sky-900">{inquiry.assigned_to_name ? `${inquiry.assigned_to_name} is the technical advisor.` : "Nobody has taken it yet."} Choose Edit &amp; Reply to work on it.</p>
          </div>
          <Link href={`${basePath}/${inquiry.id}?reply=1`} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark">
            Edit &amp; Reply
          </Link>
        </section>
      )}
      {returned && (
        <ReturnedPanel
          inquiryId={inquiry.id}
          reason={lastReturn?.body ?? null}
          returnedBy={lastReturn?.author_name ?? null}
          byTeam={returnedByTeam}
          canSend={(role === "team_leader" && inquiry.created_by === user?.id) || role === "workshop_supervisor" || role === "branch_admin" || role === "officer"}
          canReject={!returnedByTeam && canVerifyRole(role)}
        />
      )}
      {isTeam && working && (status === "open" || status === "awaiting_workshop") && <TeamReturnPanel inquiryId={inquiry.id} />}
      {rejected && (
        <section className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 shadow-sm">
          <p className="font-semibold">Rejected by the workshop supervisor</p>
          {[...(comments ?? [])].reverse().find((c) => c.kind === "rejected")?.body && (
            <p className="mt-1 whitespace-pre-wrap">{[...(comments ?? [])].reverse().find((c) => c.kind === "rejected")?.body}</p>
          )}
        </section>
      )}
      {isTeam && versions.length > 0 && (
        <details className="rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-semibold text-neutral-900">
            Edit history <span className="font-normal text-neutral-500">- {versions.length} earlier version{versions.length === 1 ? "" : "s"}</span>
          </summary>
          <ol className="mt-3 space-y-3">
            {versions.map((v, i) => {
              const after = i + 1 < versions.length ? versions[i + 1].snapshot : current;
              const changes = VERSION_FIELDS.filter(([k]) => show(v.snapshot[k]) !== show(after[k]));
              return (
                <li key={v.version_no} className="rounded-lg bg-neutral-50 p-3 text-sm">
                  <p className="text-xs text-neutral-500">
                    Version {v.version_no} - before the edit by <span className="font-semibold text-neutral-800">{v.edited_by_name ?? "Unknown"}</span>
                    {v.edited_role ? ` (${ROLE_LABEL[v.edited_role] ?? v.edited_role})` : ""} · {stamp(v.edited_at)}
                  </p>
                  {changes.length === 0 ? (
                    <p className="mt-1 text-xs text-neutral-500">No visible change.</p>
                  ) : (
                    <dl className="mt-2 space-y-2">
                      {changes.map(([k, label]) => (
                        <div key={k}>
                          <dt className="text-xs font-medium text-neutral-500">{label}</dt>
                          <dd className="grid gap-1 sm:grid-cols-2">
                            <span className="rounded bg-red-50 px-2 py-1 whitespace-pre-wrap text-red-900 line-through decoration-red-300">{show(v.snapshot[k])}</span>
                            <span className="rounded bg-emerald-50 px-2 py-1 whitespace-pre-wrap text-emerald-900">{show(after[k])}</span>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </li>
              );
            })}
          </ol>
        </details>
      )}

      {isTeam && !finished && !withSupervisor && <AssignPanel inquiryId={inquiry.id} assignedTo={inquiry.assigned_to} assignedName={inquiry.assigned_to_name} technicians={technicians} meId={user?.role === "technical" ? user.id : null} />}

      {closed && inquiry.resolution && (
        <section className="space-y-1 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-xs font-semibold tracking-wide text-emerald-800 uppercase">Solution</p>
          <p className="text-sm whitespace-pre-wrap text-emerald-950">{inquiry.resolution}</p>
          <p className="text-xs text-emerald-800">
            Closed{inquiry.closed_by_name ? ` by ${inquiry.closed_by_name}` : ""}
            {inquiry.closed_at ? ` · ${stamp(inquiry.closed_at)}` : ""}
          </p>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-700">
          Conversation <span className="font-normal text-neutral-500">({(comments ?? []).filter((c) => c.kind === "comment").length})</span>
        </h2>
        <p className="rounded-lg bg-neutral-100 px-4 py-2 text-xs text-neutral-600">
          <span className="font-semibold text-neutral-800">Case submitted</span> by {inquiry.created_by_name ?? "Unknown"}
          {inquiry.responsible_role ? ` (${RESPONSIBLE_ROLE_LABEL[inquiry.responsible_role] ?? inquiry.responsible_role})` : ""} · {stamp(inquiry.created_at)}
        </p>
        {(comments ?? []).length === 0 ? (
          <p className="rounded-xl border border-neutral-200/70 bg-white p-4 text-sm text-neutral-500 shadow-sm">No replies yet.</p>
        ) : (
          <ul className="space-y-3">
            {(comments ?? []).map((c) => {
              const mine = attachments.filter((a) => a.comment_id === c.id);
              if (c.kind !== "comment") {
                return (
                  <li key={c.id} className="rounded-lg bg-neutral-100 px-4 py-2 text-xs text-neutral-600">
                    <span className="font-semibold text-neutral-800">{EVENT_LABEL[c.kind] ?? c.kind}</span> by {c.author_name ?? "the technical team"} · {stamp(c.created_at)}
                    {c.body && <span className="mt-0.5 block whitespace-pre-wrap text-neutral-700">{c.body}</span>}
                  </li>
                );
              }
              if (c.internal) {
                return (
                  <li key={c.id} className="space-y-1.5 rounded-xl border border-dashed border-amber-400 bg-amber-50 p-4 shadow-sm">
                    <p className="text-[11px] font-semibold tracking-wide text-amber-800 uppercase">Internal note - the workshop cannot see this</p>
                    <p className="text-sm whitespace-pre-wrap text-neutral-900">{c.body}</p>
                    <p className="text-xs text-neutral-500">
                      {c.author_name ?? "Unknown"} · <span className="font-medium">{ROLE_LABEL[c.author_role ?? ""] ?? c.author_role}</span> · {stamp(c.created_at)}
                    </p>
                  </li>
                );
              }
              return (
                <li key={c.id} className={`space-y-2 rounded-xl border p-4 shadow-sm ${isWorkshopRole(c.author_role ?? "") ? "border-neutral-200/70 bg-white" : "border-sky-200 bg-sky-50/60"}`}>
                  <p className="text-sm whitespace-pre-wrap text-neutral-900">{c.body}</p>
                  <Files files={mine} />
                  <p className="text-xs text-neutral-500">
                    {c.author_name ?? "Unknown"} · <span className="font-medium">{ROLE_LABEL[c.author_role ?? ""] ?? c.author_role}</span> · {stamp(c.created_at)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {!finished && (!isTeam || working) && (
        <InquiryCommentForm
          inquiryId={inquiry.id}
          driveReady={drive !== null}
          canWriteInternal={isTeam}
          placeholder={isTeam ? "Answer the workshop, ask for more information or a photo..." : "Reply to the technical team, add the photos or results they asked for..."}
        />
      )}
      {isTeam && working && !cancelled && !rejected && !withSupervisor && !returned && <ClosePanel inquiryId={inquiry.id} closed={closed} />}
      {!isTeam && <WorkshopActions inquiryId={inquiry.id} status={status} />}
      {role === "officer" && !closed && <WorkshopActions inquiryId={inquiry.id} status={status} />}
    </div>
  );
}
