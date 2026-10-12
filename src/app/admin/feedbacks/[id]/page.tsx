import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { signFeedbackAttachments } from "@/lib/feedback-files";
import { FeedbackAttachments } from "@/components/feedback/attachments";
import { MarkSeen } from "@/components/feedback/mark-seen";
import { markFeedbackSeen } from "../actions";
import { ReplyForm } from "./reply-form";
import { DeleteFeedbackButton } from "./delete-feedback-button";

export default async function FeedbackDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("officer");
  const { id } = await params;
  const supabase = await createClient();

  const { data: feedback } = await supabase
    .from("self_audit_feedback")
    .select("id, subject, body, sender_id, branch_id, created_at, officer_seen_at")
    .eq("id", id)
    .maybeSingle();
  if (!feedback) notFound();

  const [{ data: attachmentRows }, { data: replies }, { data: sender }, { data: branch }] = await Promise.all([
    supabase.from("self_audit_feedback_attachments").select("*").eq("feedback_id", id).order("created_at"),
    supabase.from("self_audit_feedback_replies").select("id, body, created_at, author_id").eq("feedback_id", id).order("created_at"),
    supabase.from("self_audit_users").select("full_name, email").eq("id", feedback.sender_id).maybeSingle(),
    feedback.branch_id
      ? supabase.from("self_audit_branches").select("name").eq("id", feedback.branch_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const attachments = await signFeedbackAttachments(supabase, attachmentRows ?? []);

  const authorIds = [...new Set((replies ?? []).flatMap((r) => (r.author_id ? [r.author_id] : [])))];
  const { data: authors } = authorIds.length
    ? await supabase.from("self_audit_users").select("id, full_name, email").in("id", authorIds)
    : { data: [] };
  const authorName = new Map((authors ?? []).map((u) => [u.id, u.full_name?.trim() || u.email]));

  const senderName = sender?.full_name?.trim() || sender?.email || "Branch admin";

  return (
    <div className="space-y-6">
      {!feedback.officer_seen_at && <MarkSeen action={markFeedbackSeen.bind(null, id)} />}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/feedbacks" className="text-sm text-neutral-500 hover:text-neutral-800">
            &larr; Back to feedbacks
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">{feedback.subject}</h1>
          <p className="text-sm text-neutral-600">
            From <span className="font-medium text-neutral-900">{senderName}</span>
            {branch?.name ? ` · ${branch.name}` : ""}
            {sender?.email && sender.full_name?.trim() ? ` · ${sender.email}` : ""}
          </p>
          <p className="text-xs text-neutral-500">{new Date(feedback.created_at).toLocaleString()}</p>
        </div>
        <DeleteFeedbackButton feedbackId={id} attachmentCount={attachments.length} />
      </div>

      <div className="space-y-4 rounded-xl border border-neutral-200/70 bg-white p-5 shadow-sm">
        <p className="text-sm whitespace-pre-wrap text-neutral-800">{feedback.body}</p>
        <FeedbackAttachments attachments={attachments} />
      </div>

      {(replies ?? []).length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-neutral-700">Replies</h2>
          <ul className="space-y-3">
            {(replies ?? []).map((r) => (
              <li key={r.id} className="rounded-xl border border-neutral-200/70 bg-neutral-50 p-4 shadow-sm">
                <p className="text-sm whitespace-pre-wrap text-neutral-800">{r.body}</p>
                <p className="mt-2 text-xs text-neutral-500">
                  {(r.author_id && authorName.get(r.author_id)) || "Warranty team"} · {new Date(r.created_at).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ReplyForm feedbackId={id} />
    </div>
  );
}
