import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FeedbackForm } from "./feedback-form";

export default async function FeedbackPage() {
  const user = await requireRole("branch_admin");
  const supabase = await createClient();

  const [{ data: branch }, { data: feedback }, { data: replies }] = await Promise.all([
    user.branch_id
      ? supabase.from("self_audit_branches").select("name").eq("id", user.branch_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("self_audit_feedback")
      .select("id, subject, created_at")
      .eq("sender_id", user.id)
      .order("created_at", { ascending: false }),
    supabase.from("self_audit_feedback_replies").select("feedback_id, sender_seen_at"),
  ]);

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
        <p className="text-sm text-neutral-600">
          Tell the warranty team what is working, what is not, or what you need. They will see it right away and can reply
          here.
        </p>
      </section>

      <FeedbackForm userId={user.id} senderLabel={senderLabel} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-700">Your feedback</h2>
        {(feedback ?? []).length === 0 ? (
          <p className="rounded-xl border border-neutral-200/70 bg-white p-4 text-sm text-neutral-400 shadow-sm">
            You have not sent any feedback yet.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200/70 bg-white shadow-sm">
            {(feedback ?? []).map((f) => {
              const stats = replyStats.get(f.id);
              return (
                <li key={f.id}>
                  <Link
                    href={`/audit/feedback/${f.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-neutral-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-neutral-900">{f.subject}</p>
                      <p className="text-xs text-neutral-500">{new Date(f.created_at).toLocaleString()}</p>
                    </div>
                    {stats ? (
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          stats.unread > 0
                            ? "bg-red-50 text-red-700 ring-red-200"
                            : "bg-emerald-50 text-emerald-800 ring-emerald-200"
                        }`}
                      >
                        {stats.unread > 0 ? "New reply" : "Replied"}
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 ring-1 ring-inset ring-neutral-200">
                        Sent
                      </span>
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
