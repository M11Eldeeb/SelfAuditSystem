import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function FeedbacksPage() {
  await requireRole("officer");
  const supabase = await createClient();

  const [{ data: feedback }, { data: attachments }, { data: replies }, { data: users }, { data: branches }] = await Promise.all([
    supabase
      .from("self_audit_feedback")
      .select("id, subject, sender_id, branch_id, created_at, officer_seen_at")
      .order("created_at", { ascending: false }),
    supabase.from("self_audit_feedback_attachments").select("feedback_id"),
    supabase.from("self_audit_feedback_replies").select("feedback_id"),
    supabase.from("self_audit_users").select("id, full_name, email").eq("role", "branch_admin"),
    supabase.from("self_audit_branches").select("id, name"),
  ]);

  const senderName = new Map((users ?? []).map((u) => [u.id, u.full_name?.trim() || u.email]));
  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const attachmentCount = new Map<string, number>();
  (attachments ?? []).forEach((a) => attachmentCount.set(a.feedback_id, (attachmentCount.get(a.feedback_id) ?? 0) + 1));
  const replyCount = new Map<string, number>();
  (replies ?? []).forEach((r) => replyCount.set(r.feedback_id, (replyCount.get(r.feedback_id) ?? 0) + 1));

  const unread = (feedback ?? []).filter((f) => !f.officer_seen_at).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Feedbacks</h1>
        <p className="text-sm text-neutral-600">
          Messages from branch admins. Open one to read it, reply (the sender sees your reply) or delete it to free storage.
          {unread > 0 && <span className="ml-1 font-medium text-brand">{unread} unread.</span>}
        </p>
      </div>

      {(feedback ?? []).length === 0 ? (
        <p className="rounded-xl border border-neutral-200/70 bg-white p-4 text-sm text-neutral-400 shadow-sm">No feedback yet.</p>
      ) : (
        <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200/70 bg-white shadow-sm">
          {(feedback ?? []).map((f) => {
            const files = attachmentCount.get(f.id) ?? 0;
            const replied = replyCount.get(f.id) ?? 0;
            return (
              <li key={f.id}>
                <Link
                  href={`/admin/feedbacks/${f.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-neutral-50"
                >
                  <span
                    aria-label={f.officer_seen_at ? "Read" : "Unread"}
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${f.officer_seen_at ? "bg-transparent" : "bg-brand"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm ${f.officer_seen_at ? "font-medium text-neutral-700" : "font-semibold text-neutral-900"}`}>
                      {f.subject}
                    </p>
                    <p className="truncate text-xs text-neutral-500">
                      {senderName.get(f.sender_id) ?? "Branch admin"}
                      {f.branch_id ? ` · ${branchName.get(f.branch_id) ?? ""}` : ""} · {new Date(f.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-neutral-500">
                    {files > 0 && <span>{files} file{files === 1 ? "" : "s"}</span>}
                    {replied > 0 && (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
                        Replied
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
