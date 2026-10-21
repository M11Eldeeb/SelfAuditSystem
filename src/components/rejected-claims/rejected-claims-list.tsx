import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { REJECTED_PAGE_SIZE } from "@/lib/rejected-claims";
import type { CurrentUser } from "@/lib/auth";
import { getDriveStatus } from "@/lib/google-drive";
import { EntryForm } from "./entry-form";
import { DriveStatus } from "./drive-status";

type Role = "officer" | "branch_admin";
export type ListParams = { q?: string; branch?: string; page?: string; drive?: string; detail?: string };

const dateLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Search text goes into a PostgREST filter string, so strip its special characters. */
const cleanSearch = (q: string) => q.replace(/[%,()*\\:"']/g, " ").trim().slice(0, 60);

/**
 * The diary's main page for both roles: log a rejected claim, search, and the
 * list of entries (an officer sees every branch, a branch admin only their own
 * - the database enforces that, the filter here is for the officer's picker).
 */
export async function RejectedClaimsList({ user, role, params }: { user: CurrentUser; role: Role; params: ListParams }) {
  const supabase = await createClient();
  const basePath = role === "officer" ? "/admin/rejected-claims" : "/audit/rejected-claims";
  const isOfficer = role === "officer";

  const drive = await getDriveStatus();

  const { data: branchRows } = await supabase.from("self_audit_branches").select("id, name, code, active").order("name");
  const allBranches = branchRows ?? [];
  const formBranches = (isOfficer ? allBranches.filter((b) => b.active) : allBranches.filter((b) => b.id === user.branch_id)).map((b) => ({
    id: b.id,
    name: b.name,
    code: b.code,
  }));
  const branchName = new Map(allBranches.map((b) => [b.id, b.name]));

  const q = cleanSearch(params.q ?? "");
  const branchFilter = isOfficer && params.branch && allBranches.some((b) => b.id === params.branch) ? params.branch : "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const from = (page - 1) * REJECTED_PAGE_SIZE;

  let query = supabase
    .from("self_audit_rejected_claims")
    .select("*", { count: "exact" })
    .order("rejection_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, from + REJECTED_PAGE_SIZE - 1);
  if (branchFilter) query = query.eq("branch_id", branchFilter);
  if (q) query = query.or(`work_order_no.ilike.%${q}%,claim_no.ilike.%${q}%,reason.ilike.%${q}%`);
  const { data: entries, count } = await query;

  const ids = (entries ?? []).map((e) => e.id);
  const [{ data: comments }, { data: files }] = await Promise.all([
    ids.length ? supabase.from("self_audit_rejected_claim_comments").select("entry_id").in("entry_id", ids) : Promise.resolve({ data: [] as { entry_id: string }[] }),
    ids.length ? supabase.from("self_audit_rejected_claim_attachments").select("entry_id").in("entry_id", ids) : Promise.resolve({ data: [] as { entry_id: string }[] }),
  ]);
  const commentCount = new Map<string, number>();
  (comments ?? []).forEach((c) => commentCount.set(c.entry_id, (commentCount.get(c.entry_id) ?? 0) + 1));
  const fileCount = new Map<string, number>();
  (files ?? []).forEach((f) => fileCount.set(f.entry_id, (fileCount.get(f.entry_id) ?? 0) + 1));

  const total = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / REJECTED_PAGE_SIZE));
  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (branchFilter) sp.set("branch", branchFilter);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Rejected Claims From The Branch</h1>
        <p className="text-sm text-neutral-600">
          A permanent log of work orders rejected at the workshop, with the reason, comments and attachments - so you
          can always see why a claim was rejected.
        </p>
      </div>

      {isOfficer && <DriveStatus connection={drive} flag={params.drive} detail={params.detail} />}

      <EntryForm
        branches={formBranches}
        fixedBranchId={isOfficer ? undefined : (user.branch_id ?? undefined)}
        basePath={basePath}
        driveReady={drive !== null}
      />

      <form method="get" className="flex flex-wrap items-center gap-2" role="search">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search work order, claim or reason"
          aria-label="Search the rejected claims"
          className="h-9 w-full max-w-xs rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-900 shadow-sm placeholder:text-neutral-500 focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
        />
        {isOfficer && (
          <select
            name="branch"
            defaultValue={branchFilter}
            aria-label="Filter by branch"
            className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-900 shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
          >
            <option value="">All branches</option>
            {allBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <button type="submit" className="h-9 rounded-lg bg-brand px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-dark">
          Search
        </button>
        {(q || branchFilter) && (
          <Link href={basePath} className="h-9 rounded-lg px-2.5 text-sm font-medium leading-9 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800">
            Reset
          </Link>
        )}
        <span className="ml-auto text-xs text-neutral-500">
          {total} entr{total === 1 ? "y" : "ies"}
        </span>
      </form>

      {(entries ?? []).length === 0 ? (
        <p className="rounded-xl border border-neutral-200/70 bg-white p-6 text-center text-sm text-neutral-500 shadow-sm">
          {q || branchFilter ? "No entries match this search." : "Nothing has been logged yet."}
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200/70 bg-white shadow-sm">
          {(entries ?? []).map((e) => (
            <li key={e.id}>
              <Link href={`${basePath}/${e.id}`} className="flex flex-col gap-1.5 px-4 py-3 transition-colors hover:bg-neutral-50">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold text-neutral-900">{e.work_order_no}</span>
                  {e.claim_no && <span className="text-xs text-neutral-500">Claim {e.claim_no}</span>}
                  {isOfficer && (
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700 ring-1 ring-neutral-200 ring-inset">
                      {branchName.get(e.branch_id) ?? "Branch"}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-neutral-500">{dateLabel(e.rejection_date)}</span>
                </div>
                <p className="line-clamp-2 text-sm text-neutral-700">{e.reason}</p>
                <p className="text-xs text-neutral-500">
                  {e.created_by_name ? `Logged by ${e.created_by_name}` : "Logged"}
                  {(commentCount.get(e.id) ?? 0) > 0 && ` · ${commentCount.get(e.id)} comment${commentCount.get(e.id) === 1 ? "" : "s"}`}
                  {(fileCount.get(e.id) ?? 0) > 0 && ` · ${fileCount.get(e.id)} file${fileCount.get(e.id) === 1 ? "" : "s"}`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {lastPage > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 font-medium text-neutral-700 shadow-sm hover:bg-neutral-50">
              &larr; Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-neutral-500">
            Page {page} of {lastPage}
          </span>
          {page < lastPage ? (
            <Link href={pageHref(page + 1)} className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 font-medium text-neutral-700 shadow-sm hover:bg-neutral-50">
              Older &rarr;
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
