import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { REQUEST_STATUS_LABELS, REQUEST_STATUS_TONE, requestLabel } from "@/lib/part-returns";

export default async function BranchPartReturnsPage() {
  await requireRole("branch_admin");
  const supabase = await createClient();

  // RLS limits both to this branch.
  const [{ data: requests }, { data: items }] = await Promise.all([
    supabase.from("self_audit_part_returns").select("*").order("created_at", { ascending: false }).limit(100),
    supabase.from("self_audit_part_return_items").select("request_id, claim_number, status"),
  ]);

  const open = (requests ?? []).filter((r) => r.status === "open");
  const done = (requests ?? []).filter((r) => r.status !== "open");

  const row = (r: NonNullable<typeof requests>[number]) => {
    const its = (items ?? []).filter((i) => i.request_id === r.id);
    return (
      <Link
        key={r.id}
        href={`/audit/part-returns/${r.id}`}
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200/70 bg-white px-4 py-3 shadow-sm transition hover:border-brand/40"
      >
        <div>
          <div className="font-semibold text-neutral-900">{requestLabel(r.request_no)}</div>
          <div className="text-xs text-neutral-500">
            {new Set(its.map((i) => i.claim_number)).size} claims · {its.length} parts · requested{" "}
            {new Date(r.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "Asia/Riyadh" })}
          </div>
          {r.officer_note && <div className="mt-0.5 text-xs text-neutral-600">“{r.officer_note}”</div>}
        </div>
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${REQUEST_STATUS_TONE[r.status]}`}>
          {r.status === "open" ? "Action needed" : REQUEST_STATUS_LABELS[r.status]}
        </span>
      </Link>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Part Return</h1>
        <p className="text-sm text-neutral-600">Parts the warranty team needs back. Pack them, print the label, and enter the waybill.</p>
      </div>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-700">To do ({open.length})</h2>
        {open.length ? open.map(row) : <p className="text-sm text-neutral-500">Nothing to send right now.</p>}
      </section>
      {done.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-700">Done</h2>
          {done.map(row)}
        </section>
      )}
    </div>
  );
}
