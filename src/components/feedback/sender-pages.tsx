import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAnyUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { signFeedbackAttachments } from "@/lib/feedback-files";
import { FeedbackAttachments } from "@/components/feedback/attachments";
import { MarkSeen } from "@/components/feedback/mark-seen";
import { FeedbackForm } from "@/components/feedback/feedback-form";
import { markRepliesSeen } from "@/app/audit/feedback/actions";

/**
 * The Feedback pages every role uses to write to the warranty team and read the replies. Each part of the site
 * (branch admin, technician, technical team, ...) mounts them under its own address (`basePath`).
 */
export async function FeedbackSenderPage({ basePath }: { basePath: string }) {
  const user = await requireAnyUser();
  const supabase = await createClient();

  const [{ data: branch }, { data: feedback }] = await Promise.all([
    user.branch_id ? supabase.from("self_audit_branches").select("name").eq("id", user.branch_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("self_audit_feedback").select("id, subject, created_at").eq("sender_id", user.id).order("created_at", { ascending: false }),
  ]);
  // Only the replies to this person's own messages (some accounts can read every reply).
  const ids = (feedback ?? []).map((f) => f.id);
  const { data: replies } = ids.length
    ? await supabase.from("self_audit_feedback_replies").select("feedback_id, sender_seen_at").in("feedback_id", ids)
    : { data: [] as { feedback_id: string; sender_seen_at: string | null }[] };

  const replyStats = new Map<string, { total: number; unread: number }>();
  for (const r of replies ?? []) {
    const s = replyStats.get(r.feedback_id) ?? { total: 0, unread: 0 };
    s.total += 1;
    if (!r.sender_seen_at) s.unread += 1;
    replyStats.set(r.feedback_id, s);
  }

  const name = user.full_name?.trim() || user.email;
  const senderLabel = `${name}${branch?.name ? ` · ${branch.name}` : ""}`;

  return (
    <div className="space-y-8">
      <section className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Feedback</h1>
        <p className="text-sm text-neutral-600">Tell the warranty team what is working, what is not, or what you need. They will see it right away and can reply here.</p>
      </section>

      <FeedbackForm userId={user.id} senderLabel={senderLabel} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-700">Your feedback</h2>
        {(feedback ?? []).length === 0 ? (
          <p className="rounded-xl border border-neutral-200/70 bg-white p-4 text-sm text-neutral-400 shadow-sm">You have not sent any feedback yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200/70 bg-white shadow-sm">
            {(feedback ?? []).map((f) => {
              const stats = replyStats.get(f.id);
              return (
                <li key={f.id}>
                  <Link href={`${basePath}/${f.id}`} className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-neutral-50">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-neutral-900">{f.subject}</p>
                      <p className="text-xs text-neutral-500">{new Date(f.created_at).toLocaleString()}</p>
                    </div>
                    {stats ? (
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          stats.unread > 0 ? "bg-red-50 text-red-700 ring-red-200" : "bg-emerald-50 text-emerald-800 ring-emerald-200"
                        }`}
                      >
                        {stats.unread > 0 ? "New reply" : "Replied"}
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 ring-1 ring-inset ring-neutral-200">Sent</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

export async function FeedbackThreadPage({ basePath, id }: { basePath: string; id: string }) {
  const user = await requireAnyUser();
  const supabase = await createClient();

  const { data: feedback } = await supabase.from("self_audit_feedback").select("id, subject, body, created_at").eq("id", id).eq("sender_id", user.id).maybeSingle();
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
        <Link href={basePath} className="text-sm text-neutral-500 hover:text-neutral-800">
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
          <p className="rounded-xl border border-neutral-200/70 bg-white p-4 text-sm text-neutral-400 shadow-sm">No reply yet.</p>
        ) : (
          <ul className="space-y-3">
            {(replies ?? []).map((r) => (
              <li key={r.id} className={`rounded-xl border bg-white p-4 shadow-sm ${r.sender_seen_at ? "border-neutral-200/70" : "border-brand/40 ring-1 ring-brand/15"}`}>
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
