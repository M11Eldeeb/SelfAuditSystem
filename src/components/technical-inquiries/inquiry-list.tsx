import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { CurrentUser } from "@/lib/auth";
import { getDriveStatus } from "@/lib/google-drive";
import { getCurrentInquiryTerms } from "@/lib/technical-inquiries-server";
import { INQUIRY_PAGE_SIZE, STATUS_BADGE, STATUS_LABEL, basePathFor, inquiryLabel, statusTabs, type InquiryRole } from "@/lib/technical-inquiries";
import { InquiryForm } from "./inquiry-form";
import { TermsEditor } from "./terms-editor";

export type InquiryListParams = { q?: string; tab?: string; branch?: string; page?: string };

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Riyadh" });

/** Search text goes into a PostgREST filter string, so strip its special characters. */
const cleanSearch = (q: string) => q.replace(/[%,()*\\:"']/g, " ").trim().slice(0, 60);

/**
 * The inquiries list for all three roles: submit one (workshop / warranty team), filter by status, search by work
 * order, VIN, model or fault, and the list itself. The database decides what each role sees (a branch admin: their
 * own branch only); the branch filter here is just the officers' and technical team's picker.
 */
export async function InquiryList({ user, role, params }: { user: CurrentUser; role: InquiryRole; params: InquiryListParams }) {
  const supabase = await createClient();
  const basePath = basePathFor(role);
  const isBranch = role === "branch_admin";
  const canSubmit = role !== "technical";

  const [drive, terms, { data: branchRows }] = await Promise.all([
    getDriveStatus(),
    getCurrentInquiryTerms(),
    supabase.from("self_audit_branches").select("id, name, code, active").order("name"),
  ]);
  const allBranches = branchRows ?? [];
  const formBranches = (isBranch ? allBranches.filter((b) => b.id === user.branch_id) : allBranches.filter((b) => b.active)).map((b) => ({ id: b.id, name: b.name, code: b.code }));
  const branchName = new Map(allBranches.map((b) => [b.id, b.name]));

  const tabs = statusTabs(role);
  const tab = tabs.find((t) => t.key === params.tab) ?? tabs[0];
  const q = cleanSearch(params.q ?? "");
  const branchFilter = !isBranch && params.branch && allBranches.some((b) => b.id === params.branch) ? params.branch : "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const from = (page - 1) * INQUIRY_PAGE_SIZE;

  let query = supabase
    .from("self_audit_technical_inquiries")
    .select("*", { count: "exact" })
    .order("updated_at", { ascending: false })
    .range(from, from + INQUIRY_PAGE_SIZE - 1);
  if (tab.statuses) query = query.in("status", tab.statuses);
  if (branchFilter) query = query.eq("branch_id", branchFilter);
  if (q) query = query.or(`work_order_no.ilike.%${q}%,vin.ilike.%${q}%,vehicle_model.ilike.%${q}%,fault_complaint.ilike.%${q}%`);

  const countStatus = async (status: "open" | "awaiting_workshop" | "closed") => {
    let c = supabase.from("self_audit_technical_inquiries").select("id", { count: "exact", head: true }).eq("status", status);
    if (branchFilter) c = c.eq("branch_id", branchFilter);
    return (await c).count ?? 0;
  };
  const [{ data: inquiries, count }, nOpen, nAwaiting, nClosed] = await Promise.all([query, countStatus("open"), countStatus("awaiting_workshop"), countStatus("closed")]);
  const tabCount: Record<string, number> = { open: nOpen, awaiting: nAwaiting, closed: nClosed, all: nOpen + nAwaiting + nClosed };

  const ids = (inquiries ?? []).map((i) => i.id);
  const { data: comments } = ids.length ? await supabase.from("self_audit_technical_inquiry_comments").select("inquiry_id").eq("kind", "comment").in("inquiry_id", ids) : { data: [] as { inquiry_id: string }[] };
  const commentCount = new Map<string, number>();
  (comments ?? []).forEach((c) => commentCount.set(c.inquiry_id, (commentCount.get(c.inquiry_id) ?? 0) + 1));

  const total = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / INQUIRY_PAGE_SIZE));
  const href = (over: { tab?: string; page?: number }) => {
    const sp = new URLSearchParams();
    const t = over.tab ?? tab.key;
    if (t !== tabs[0].key) sp.set("tab", t);
    if (q) sp.set("q", q);
    if (branchFilter) sp.set("branch", branchFilter);
    if ((over.page ?? 1) > 1) sp.set("page", String(over.page));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Technical Inquiries</h1>
        <p className="text-sm text-neutral-600">
          {isBranch
            ? "Escalate a workshop problem to the technical team, follow their answer and reply."
            : "Workshop problems escalated to the technical team. Answer, ask for more, and close each case with the solution."}
        </p>
      </div>

      {role === "officer" && <TermsEditor terms={terms} />}

      {canSubmit && (
        <InquiryForm
          branches={formBranches}
          fixedBranchId={isBranch ? (user.branch_id ?? undefined) : undefined}
          basePath={basePath}
          driveReady={drive !== null}
          terms={terms}
        />
      )}

      <nav aria-label="Status" className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={href({ tab: t.key })}
            aria-current={t.key === tab.key ? "page" : undefined}
            className={`rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset transition-colors ${
              t.key === tab.key ? "bg-brand text-white ring-brand" : "bg-white text-neutral-700 ring-neutral-200 hover:bg-neutral-50"
            }`}
          >
            {t.label} <span className={t.key === tab.key ? "text-white/80" : "text-neutral-500"}>{tabCount[t.key] ?? 0}</span>
          </Link>
        ))}
      </nav>

      <form method="get" className="flex flex-wrap items-center gap-2" role="search">
        {tab.key !== tabs[0].key && <input type="hidden" name="tab" value={tab.key} />}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search work order, VIN, model or fault"
          aria-label="Search the inquiries"
          className="h-9 w-full max-w-xs rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-900 shadow-sm placeholder:text-neutral-500 focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
        />
        {!isBranch && (
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
          <Link href={tab.key === tabs[0].key ? basePath : `${basePath}?tab=${tab.key}`} className="h-9 rounded-lg px-2.5 text-sm leading-9 font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800">
            Reset
          </Link>
        )}
        <span className="ml-auto text-xs text-neutral-500">
          {total} case{total === 1 ? "" : "s"}
        </span>
      </form>

      {(inquiries ?? []).length === 0 ? (
        <p className="rounded-xl border border-neutral-200/70 bg-white p-6 text-center text-sm text-neutral-500 shadow-sm">
          {q || branchFilter ? "No cases match this search." : "No cases here."}
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200/70 bg-white shadow-sm">
          {(inquiries ?? []).map((i) => (
            <li key={i.id}>
              <Link href={`${basePath}/${i.id}`} className="flex flex-col gap-1.5 px-4 py-3 transition-colors hover:bg-neutral-50">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold text-neutral-900">{inquiryLabel(i.inquiry_no)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STATUS_BADGE[i.status]}`}>{STATUS_LABEL[i.status]}</span>
                  {!isBranch && (
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700 ring-1 ring-neutral-200 ring-inset">{branchName.get(i.branch_id) ?? "Branch"}</span>
                  )}
                  <span className="ml-auto text-xs text-neutral-500">{dateLabel(i.updated_at)}</span>
                </div>
                <p className="text-sm text-neutral-800">
                  <span className="font-medium">{i.work_order_no}</span> <span className="text-neutral-500">·</span> {i.vehicle_model} <span className="text-neutral-500">·</span>{" "}
                  <span className="font-mono text-xs">{i.vin}</span>
                </p>
                <p className="line-clamp-2 text-sm text-neutral-600">{i.fault_complaint}</p>
                {(commentCount.get(i.id) ?? 0) > 0 && <p className="text-xs text-neutral-500">{commentCount.get(i.id)} comment{commentCount.get(i.id) === 1 ? "" : "s"}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {lastPage > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={href({ page: page - 1 })} className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 font-medium text-neutral-700 shadow-sm hover:bg-neutral-50">
              &larr; Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-neutral-500">
            Page {page} of {lastPage}
          </span>
          {page < lastPage ? (
            <Link href={href({ page: page + 1 })} className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 font-medium text-neutral-700 shadow-sm hover:bg-neutral-50">
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
