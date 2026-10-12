import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { signFeedbackAttachments } from "@/lib/feedback-files";
import { FeedbackAttachments } from "@/components/feedback/attachments";
import { MarkSeen } from "@/components/feedback/mark-seen";
import { markRepliesSeen } from "../actions";

export default async function FeedbackThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("branch_admin");
  const { id } = await params;
  const supabase = await createClient();

  const { data: feedback } = await supabase
    .from("self_audit_feedback")
    .select("id, subject, body, created_at")
    .eq("id", id)
    .eq("sender_id", user.id)
    .maybeSingle();
  if (!feedback) notFound();

  const [{ data: attachmentRows }, { data: replies }] = await Promise.all([
    supabase.from("self_audit_feedback_attachments").select("*").eq("feedback_id", id).order("created_at"),
    supabase.from("self_audit_feedback_replies").select("id, body, created_at, sender_seen_at").eq("feedback_id", id).order("created_at"),
  ]);
  const attachments = await signFeedbackAttachments(supabase, attachmentRows ?? []);
  const hasUnread = (replies ?? []).some((r) => !r.sender_seen_at);

  return (
    <div className="space-y-6">
      {hasUnread && <MarkSeen action={markRepliesSeen.bind(null, id)} />}

      <div>
        <Link href="/audit/feedback" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Back to feedback
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-900">{feedback.subject}</h1>
        <p className="text-xs text-neutral-500">Sent {new Date(feedback.created_at).toLocaleString()}</p>
      </div>

      <div className="space-y-4 rounded-xl border border-neutral-200/70 bg-white p-5 shadow-sm">
        <p className="text-sm whitespace-pre-wrap text-neutral-800">{feedback.body}</p>
        <FeedbackAttachments attachments={attachments} />
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-700">Replies from the warranty team</h2>
        {(replies ?? []).length === 0 ? (
          <p className="rounded-xl border border-neutral-200/70 bg-white p-4 text-sm text-neutral-400 shadow-sm">
            No reply yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {(replies ?? []).map((r) => (
              <li
                key={r.id}
                className={`rounded-xl border bg-white p-4 shadow-sm ${
                  r.sender_seen_at ? "border-neutral-200/70" : "border-brand/40 ring-1 ring-brand/15"
                }`}
              >
                <p className="text-sm whitespace-pre-wrap text-neutral-800">{r.body}</p>
                <p className="mt-2 text-xs text-neutral-500">
                  Warranty team · {new Date(r.created_at).toLocaleString()}
                  {!r.sender_seen_at && <span className="ml-2 font-medium text-brand">New</span>}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
