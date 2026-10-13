import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDriveStatus } from "@/lib/google-drive";
import { RebuildLogbookButton } from "./rebuild-logbook-button";
import { CommentForm } from "./comment-form";

type Role = "officer" | "branch_admin";

const dateLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const stamp = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** One entry: the rejection, its files, and the comment thread with an add-comment box. */
export async function RejectedClaimDetail({ role, id }: { role: Role; id: string }) {
  const supabase = await createClient();
  const basePath = role === "officer" ? "/admin/rejected-claims" : "/audit/rejected-claims";

  // RLS decides what the caller may see: a branch admin gets nothing for another branch's entry.
  const { data: entry } = await supabase.from("self_audit_rejected_claims").select("*").eq("id", id).maybeSingle();
  if (!entry) notFound();

  const [{ data: branch }, { data: comments }, { data: attachmentRows }] = await Promise.all([
    supabase.from("self_audit_branches").select("name").eq("id", entry.branch_id).maybeSingle(),
    supabase.from("self_audit_rejected_claim_comments").select("*").eq("entry_id", id).order("created_at"),
    supabase.from("self_audit_rejected_claim_attachments").select("*").eq("entry_id", id).order("created_at"),
  ]);
  const attachments = attachmentRows ?? [];
  const driveReady = (await getDriveStatus()) !== null;
  // The work order's own Drive folder (it holds the files and the logbook PDF).
  const { data: folderRow } = await createAdminClient().from("self_audit_drive_folders").select("drive_id").eq("key", `wo:${entry.branch_id}:${entry.work_order_no}`).maybeSingle();
  const folderUrl = folderRow ? `https://drive.google.com/drive/folders/${folderRow.drive_id}` : null;
  const entryFileCount = attachments.filter((a) => a.comment_id === null).length;
  const historyCount = attachments.filter((a) => a.kind === "service_history").length;
  const details = [
    ["Customer", entry.customer_name],
    ["Vehicle model", entry.vehicle_model],
    ["Service advisor", entry.service_advisor],
    ["Team leader", entry.team_leader],
  ].filter((d): d is [string, string] => !!d[1]);
  const hasInfo = details.length > 0 || entry.labours.length > 0 || entry.parts.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <Link href={basePath} className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to the diary
        </Link>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{entry.work_order_no}</h1>
          {entry.duplicate_of && (
            <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200 ring-inset">
              Repeat of {entry.duplicate_of}
            </span>
          )}
          {role === "officer" && branch?.name && (
            <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-700 ring-1 ring-neutral-200 ring-inset">
              {branch.name}
            </span>
          )}
        </div>
      </div>

      <section className="space-y-4 rounded-xl border border-neutral-200/70 bg-white p-5 shadow-sm">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium text-neutral-500">Rejected on</dt>
            <dd className="font-medium text-neutral-900">{dateLabel(entry.rejection_date)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-neutral-500">Claim number</dt>
            <dd className="font-medium text-neutral-900">{entry.claim_no ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-neutral-500">Logged by</dt>
            <dd className="font-medium text-neutral-900">
              {entry.created_by_name ?? "—"}
              <span className="block text-xs font-normal text-neutral-500">{stamp(entry.created_at)}</span>
            </dd>
          </div>
        </dl>
        <div>
          <p className="text-xs font-medium text-neutral-500">Reason for the rejection</p>
          <p className="mt-1 text-sm whitespace-pre-wrap text-neutral-900">{entry.reason}</p>
        </div>
      </section>

      {hasInfo && (
        <section className="space-y-4 rounded-xl border border-neutral-200/70 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-700">Additional information</h2>
          {details.length > 0 && (
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {details.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-medium text-neutral-500">{label}</dt>
                  <dd className="font-medium text-neutral-900">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          {entry.labours.length > 0 && (
            <div>
              <p className="text-xs font-medium text-neutral-500">Labour description</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-neutral-900">
                {entry.labours.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>
          )}
          {entry.parts.length > 0 && (
            <div>
              <p className="text-xs font-medium text-neutral-500">Parts needed for the repair</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-neutral-900">
                {entry.parts.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200/70 bg-white px-4 py-3 shadow-sm">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-neutral-900">Photos, videos and documents</p>
          <p className="text-xs text-neutral-500">
            {attachments.length === 0
              ? "Nothing has been attached yet."
              : `${attachments.length} file${attachments.length === 1 ? "" : "s"} (${entryFileCount} with the entry${historyCount > 0 ? `, ${historyCount} of them service history` : ""}, ${attachments.length - entryFileCount} with comments) in this work order's Google Drive folder.`}
          </p>
        </div>
        {folderUrl ? (
          <a
            href={folderUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-dark"
          >
            Open on Google Drive
          </a>
        ) : (
          <span className="text-xs text-neutral-500">{driveReady ? "The folder is created when the first file or the logbook is saved." : "Google Drive is not connected yet."}</span>
        )}
        {role === "officer" && driveReady && <RebuildLogbookButton entryId={entry.id} />}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-700">
          Comments <span className="font-normal text-neutral-500">({(comments ?? []).length})</span>
        </h2>
        {(comments ?? []).length === 0 ? (
          <p className="rounded-xl border border-neutral-200/70 bg-white p-4 text-sm text-neutral-500 shadow-sm">No comments yet.</p>
        ) : (
          <ul className="space-y-3">
            {(comments ?? []).map((c) => {
              const fileCount = attachments.filter((a) => a.comment_id === c.id).length;
              return (
                <li key={c.id} className="space-y-3 rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
                  <p className="text-sm whitespace-pre-wrap text-neutral-900">{c.body}</p>
                  {fileCount > 0 && (
                    <p className="text-xs text-neutral-500">
                      {fileCount} file{fileCount === 1 ? "" : "s"} attached - in the Drive folder.
                    </p>
                  )}
                  <p className="text-xs text-neutral-500">
                    {c.author_name ?? "Unknown"}
                    {c.author_role === "officer" ? " · Warranty team" : ""} · {stamp(c.created_at)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <CommentForm entryId={entry.id} driveReady={driveReady} />
    </div>
  );
}
