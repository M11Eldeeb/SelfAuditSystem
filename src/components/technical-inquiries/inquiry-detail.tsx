import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDriveStatus } from "@/lib/google-drive";
import { ROLE_LABEL, STATUS_BADGE, STATUS_LABEL, basePathFor, driveFileUrl, driveFolderUrl, inquiryLabel, type InquiryRole } from "@/lib/technical-inquiries";
import { formatBytes } from "@/lib/feedback-constants";
import { InquiryCommentForm } from "./comment-form";
import { ClosePanel } from "./close-panel";

const stamp = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" });

type Attachment = { id: string; comment_id: string | null; drive_file_id: string; file_name: string; mime_type: string; size_bytes: number };

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

/** One inquiry: the case details, the files (in Google Drive), the conversation, and what this role can do about it. */
export async function InquiryDetail({ role, id }: { role: InquiryRole; id: string }) {
  const supabase = await createClient();
  const basePath = basePathFor(role);

  // RLS decides what the caller may see: a branch admin gets nothing for another branch's case.
  const { data: inquiry } = await supabase.from("self_audit_technical_inquiries").select("*").eq("id", id).maybeSingle();
  if (!inquiry) notFound();

  const [{ data: branch }, { data: comments }, { data: attachmentRows }, drive, { data: folder }] = await Promise.all([
    supabase.from("self_audit_branches").select("name").eq("id", inquiry.branch_id).maybeSingle(),
    supabase.from("self_audit_technical_inquiry_comments").select("*").eq("inquiry_id", id).order("created_at"),
    supabase.from("self_audit_technical_inquiry_attachments").select("*").eq("inquiry_id", id).order("created_at"),
    getDriveStatus(),
    createAdminClient().from("self_audit_drive_folders").select("drive_id").eq("key", `inquiry:case:${id}`).maybeSingle(),
  ]);
  const attachments = (attachmentRows ?? []) as Attachment[];
  const caseFiles = attachments.filter((a) => a.comment_id === null);
  const isTeam = role === "technical" || role === "officer";
  const closed = inquiry.status === "closed";

  return (
    <div className="space-y-6">
      <div>
        <Link href={basePath} className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to the inquiries
        </Link>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{inquiryLabel(inquiry.inquiry_no)}</h1>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_BADGE[inquiry.status]}`}>{STATUS_LABEL[inquiry.status]}</span>
          {role !== "branch_admin" && branch?.name && (
            <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-700 ring-1 ring-neutral-200 ring-inset">{branch.name}</span>
          )}
        </div>
      </div>

      <section className="space-y-4 rounded-xl border border-neutral-200/70 bg-white p-5 shadow-sm">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs font-medium text-neutral-500">Work order</dt>
            <dd className="font-medium text-neutral-900">{inquiry.work_order_no}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-neutral-500">VIN</dt>
            <dd className="font-mono text-[13px] font-medium break-all text-neutral-900">{inquiry.vin}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-neutral-500">Vehicle model</dt>
            <dd className="font-medium text-neutral-900">{inquiry.vehicle_model}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-neutral-500">Submitted by</dt>
            <dd className="font-medium text-neutral-900">
              {inquiry.created_by_name ?? "—"}
              <span className="block text-xs font-normal text-neutral-500">{stamp(inquiry.created_at)}</span>
            </dd>
          </div>
        </dl>
        <div>
          <p className="text-xs font-medium text-neutral-500">Fault complaint</p>
          <p className="mt-1 text-sm whitespace-pre-wrap text-neutral-900">{inquiry.fault_complaint}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-neutral-500">What the workshop did</p>
          <p className="mt-1 text-sm whitespace-pre-wrap text-neutral-900">{inquiry.actions_taken}</p>
        </div>
        {inquiry.workshop_comments && (
          <div>
            <p className="text-xs font-medium text-neutral-500">Comments of the workshop</p>
            <p className="mt-1 text-sm whitespace-pre-wrap text-neutral-900">{inquiry.workshop_comments}</p>
          </div>
        )}
        {caseFiles.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-neutral-500">Attachments</p>
            <Files files={caseFiles} />
          </div>
        )}
      </section>

      {folder && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200/70 bg-white px-4 py-3 shadow-sm">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-neutral-900">Photos, videos and documents</p>
            <p className="text-xs text-neutral-500">
              {attachments.length === 0 ? "Nothing has been attached yet." : `${attachments.length} file${attachments.length === 1 ? "" : "s"} in this case's Google Drive folder.`}
            </p>
          </div>
          <a
            href={driveFolderUrl(folder.drive_id)}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-dark"
          >
            Open on Google Drive
          </a>
        </section>
      )}

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
          Conversation <span className="font-normal text-neutral-500">({(comments ?? []).length})</span>
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
                    <span className="font-semibold text-neutral-800">{c.kind === "closed" ? "Case closed" : "Case reopened"}</span> by {c.author_name ?? "the technical team"} · {stamp(c.created_at)}
                    {c.kind === "reopened" && c.body && <span className="mt-0.5 block whitespace-pre-wrap text-neutral-700">{c.body}</span>}
                  </li>
                );
              }
              return (
                <li key={c.id} className={`space-y-2 rounded-xl border p-4 shadow-sm ${c.author_role === "branch_admin" ? "border-neutral-200/70 bg-white" : "border-sky-200 bg-sky-50/60"}`}>
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

      {!closed && (
        <InquiryCommentForm
          inquiryId={inquiry.id}
          driveReady={drive !== null}
          placeholder={isTeam ? "Answer the workshop, ask for more information or a photo..." : "Reply to the technical team, add the photos or results they asked for..."}
        />
      )}
      {isTeam && <ClosePanel inquiryId={inquiry.id} closed={closed} />}
      {!isTeam && closed && <p className="rounded-xl border border-neutral-200/70 bg-white p-4 text-sm text-neutral-600 shadow-sm">This case is closed. If the problem comes back, ask the technical team to reopen it.</p>}
    </div>
  );
}
