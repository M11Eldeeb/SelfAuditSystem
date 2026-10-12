import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signRejectedAttachments } from "@/lib/rejected-claims-server";
import { FeedbackAttachments } from "@/components/feedback/attachments";
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
  const attachments = await signRejectedAttachments(supabase, attachmentRows ?? []);
  const entryFiles = attachments.filter((a) => a.commentId === null);

  return (
    <div className="space-y-6">
      <div>
        <Link href={basePath} className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to the diary
        </Link>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{entry.work_order_no}</h1>
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
        {entryFiles.length > 0 && <FeedbackAttachments attachments={entryFiles} />}
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
              const files = attachments.filter((a) => a.commentId === c.id);
              return (
                <li key={c.id} className="space-y-3 rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
                  <p className="text-sm whitespace-pre-wrap text-neutral-900">{c.body}</p>
                  {files.length > 0 && <FeedbackAttachments attachments={files} />}
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

      <CommentForm entryId={entry.id} branchId={entry.branch_id} />
    </div>
  );
}
