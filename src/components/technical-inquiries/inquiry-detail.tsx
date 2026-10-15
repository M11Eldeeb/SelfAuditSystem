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
import { AssignPanel, VerifyPanel, WorkshopActions } from "./case-actions";

const stamp = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" });

type Attachment = { id: string; comment_id: string | null; drive_file_id: string; file_name: string; mime_type: string; size_bytes: number; category: AttachmentCategory; wip_id: string | null; step_no: number | null };

const EVENT_LABEL: Record<string, string> = {
  closed: "Case closed",
  reopened: "Case reopened",
  cancelled: "Case cancelled",
  verified: "Verified by the workshop supervisor - sent to the technical team",
  rejected: "Sent back by the workshop supervisor",
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

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-neutral-500">{label}</dt>
      <dd className="font-medium text-neutral-900">{children}</dd>
    </div>
  );
}

/** One inquiry: the case details, the files (in Google Drive), the conversation, and what this role can do about it. */
export async function InquiryDetail({ role, id }: { role: InquiryRole; id: string }) {
  const supabase = await createClient();
  const basePath = basePathFor(role);
  const isTeam = role === "technical" || role === "officer";

  // The first technician to open an unassigned case gets it (the database does nothing for anyone else or for a case that has a technician).
  if (role === "technical") await supabase.rpc("claim_technical_inquiry", { p_inquiry_id: id });

  // RLS decides what the caller may see: a branch admin gets nothing for another branch's case.
  const { data: inquiry } = await supabase.from("self_audit_technical_inquiries").select("*").eq("id", id).maybeSingle();
  if (!inquiry) notFound();

  const [user, { data: branch }, { data: comments }, { data: attachmentRows }, { data: wipRows }, drive, { data: folder }, { data: techRows }] = await Promise.all([
    getCurrentUser(),
    supabase.from("self_audit_branches").select("name").eq("id", inquiry.branch_id).maybeSingle(),
    // Internal notes come back only for the technical team and officers (the database hides them from the workshop).
    supabase.from("self_audit_technical_inquiry_comments").select("*").eq("inquiry_id", id).order("created_at"),
    supabase.from("self_audit_technical_inquiry_attachments").select("*").eq("inquiry_id", id).order("created_at"),
    supabase.from("self_audit_inquiry_work_orders").select("*").eq("inquiry_id", id).order("position"),
    getDriveStatus(),
    createAdminClient().from("self_audit_drive_folders").select("drive_id").eq("key", `inquiry:case:${id}`).maybeSingle(),
    isTeam ? createAdminClient().from("self_audit_users").select("id, full_name, email").eq("role", "technical").order("full_name") : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string }[] }),
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
  const finished = closed || cancelled;
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

      <section className="space-y-4 rounded-xl border border-neutral-200/70 bg-white p-5 shadow-sm">
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
      </section>

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

      {isTeam && !finished && !awaitingVerification && <AssignPanel inquiryId={inquiry.id} assignedTo={inquiry.assigned_to} assignedName={inquiry.assigned_to_name} technicians={technicians} meId={user?.role === "technical" ? user.id : null} />}

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

      {!finished && (
        <InquiryCommentForm
          inquiryId={inquiry.id}
          driveReady={drive !== null}
          canWriteInternal={isTeam}
          placeholder={isTeam ? "Answer the workshop, ask for more information or a photo..." : "Reply to the technical team, add the photos or results they asked for..."}
        />
      )}
      {isTeam && !cancelled && !awaitingVerification && <ClosePanel inquiryId={inquiry.id} closed={closed} />}
      {!isTeam && <WorkshopActions inquiryId={inquiry.id} status={status} />}
      {role === "officer" && !closed && <WorkshopActions inquiryId={inquiry.id} status={status} />}
    </div>
  );
}
