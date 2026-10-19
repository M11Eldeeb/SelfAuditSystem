import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CurrentUser } from "@/lib/auth";
import { getDriveStatus } from "@/lib/google-drive";
import {
  INQUIRY_PAGE_SIZE,
  STATUS_BADGE,
  STATUS_LABEL,
  SYSTEMS,
  SYSTEM_LABEL,
  basePathFor,
  inquiryLabel,
  isLate,
  isWorkshopRole,
  statusTabs,
  waitingText,
  type InquiryRole,
  type InquiryStatus,
  type InquirySystem,
} from "@/lib/technical-inquiries";
import { InquiryForm } from "./inquiry-form";
import { RoutingEditor } from "./routing-editor";
import { ServicePicker } from "./service-picker";
import { VerificationRequestForm } from "@/components/verification-codes/request-form";
import { VerificationRequestsSection } from "@/components/verification-codes/requests-section";
import { OcrAccuracy } from "@/components/verification-codes/ocr-accuracy";

export type InquiryListParams = { q?: string; tab?: string; branch?: string; system?: string; mine?: string; page?: string; view?: string; open?: string };

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Riyadh" });

/** Search text goes into a PostgREST filter string, so strip its special characters. */
const cleanSearch = (q: string) => q.replace(/[%,()*\\:"']/g, " ").trim().slice(0, 60);

const selectClass = "h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-900 shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none";

/**
 * The inquiries list for all three roles: submit one (workshop / warranty team), filter by status, search, and the list
 * itself. The database decides what each role sees (a branch admin: their own branch only); the branch, system and "my
 * cases" filters are the team's pickers. Cases waiting more than two days are shown in red, cars still in the workshop first.
 */
export async function InquiryList({ user, role, params }: { user: CurrentUser; role: InquiryRole; params: InquiryListParams }) {
  const supabase = await createClient();
  const basePath = basePathFor(role);
  const isBranch = isWorkshopRole(role);
  const isTeam = !isBranch;
  const canSubmit = role !== "technical";

  const [drive, { data: branchRows }, { data: techRows }, { data: routingRows }] = await Promise.all([
    getDriveStatus(),
    supabase.from("self_audit_branches").select("id, name, code, active").order("name"),
    role === "officer" ? createAdminClient().from("self_audit_users").select("id, full_name, email").eq("role", "technical").order("full_name") : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string }[] }),
    role === "officer" ? supabase.from("self_audit_inquiry_routing").select("branch_id, technician_id") : Promise.resolve({ data: [] as { branch_id: string; technician_id: string | null }[] }),
  ]);
  const allBranches = branchRows ?? [];
  let formBranches = (isBranch ? allBranches.filter((b) => b.id === user.branch_id) : allBranches.filter((b) => b.active)).map((b) => ({ id: b.id, name: b.name, code: b.code }));
  if (isBranch && user.branch_id && formBranches.length === 0) {
    const { data: own } = await createAdminClient().from("self_audit_branches").select("id, name, code").eq("id", user.branch_id).maybeSingle();
    if (own) formBranches = [own];
  }
  const branchName = new Map(allBranches.map((b) => [b.id, b.name]));

  // Verification code requests live here too: the workshop picks the service, and a view switch shows the codes.
  const showCodes = params.view === "codes";
  let openCodes = createAdminClient().from("self_audit_verification_requests").select("id", { count: "exact", head: true }).eq("status", "open");
  if (isBranch) openCodes = openCodes.eq("branch_id", user.branch_id ?? "00000000-0000-0000-0000-000000000000");
  const { count: openCodeCount } = await openCodes;
  const viewSwitch = (
    <nav aria-label="Service" className="flex gap-1 rounded-xl bg-neutral-100 p-1 text-sm font-semibold">
      <Link href={basePath} aria-current={!showCodes ? "page" : undefined} className={`flex-1 rounded-lg px-3 py-1.5 text-center ${!showCodes ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"}`}>
        Technical inquiries
      </Link>
      <Link href={`${basePath}?view=codes`} aria-current={showCodes ? "page" : undefined} className={`flex-1 rounded-lg px-3 py-1.5 text-center ${showCodes ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"}`}>
        Verification codes{openCodeCount ? <span className="ml-1.5 rounded-full bg-brand px-1.5 py-0.5 text-[11px] text-white">{openCodeCount}</span> : null}
      </Link>
    </nav>
  );
  const inquiryForm = canSubmit ? (
    <InquiryForm branches={formBranches} fixedBranchId={isBranch ? (user.branch_id ?? undefined) : undefined} basePath={basePath} driveReady={drive !== null} />
  ) : null;
  // The workshop chooses the service first; the warranty team only files inquiries.
  const newRequest = isBranch ? <ServicePicker inquiryForm={inquiryForm} codeForm={<VerificationRequestForm />} /> : inquiryForm;

  if (showCodes) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Technical Inquiries</h1>
          <p className="text-sm text-neutral-600">
            {isBranch ? "Ask the technical team for a verification code - you get it by e-mail." : "Verification code requests from the workshops: send the code, or reject with a reason."}
          </p>
        </div>
        {viewSwitch}
        {newRequest}
        {role === "officer" && <OcrAccuracy />}
        <VerificationRequestsSection user={user} canAnswer={!isBranch} openId={params.open} />
      </div>
    );
  }

  const tabs = statusTabs(role);
  const tab = tabs.find((t) => t.key === params.tab) ?? tabs[0];
  const q = cleanSearch(params.q ?? "");
  const branchFilter = isTeam && params.branch && allBranches.some((b) => b.id === params.branch) ? params.branch : "";
  const systemFilter = (SYSTEMS as readonly string[]).includes(params.system ?? "") ? (params.system as InquirySystem) : "";
  const mine = role === "technical" && params.mine === "1";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const from = (page - 1) * INQUIRY_PAGE_SIZE;

  // The filters every query below shares (status is added per query).
  const withFilters = <T extends { eq: (c: string, v: string) => T; or: (f: string) => T }>(query: T): T => {
    let next = query;
    if (branchFilter) next = next.eq("branch_id", branchFilter);
    if (systemFilter) next = next.eq("system", systemFilter);
    if (mine) next = next.eq("assigned_to", user.id);
    if (q) {
      next = next.or(
        ["work_order_no", "vin", "plate_number", "vehicle_model", "fault_complaint", "actions_taken", "resolution", "dtc_codes", "parts_replaced", "responsible_name"].map((c) => `${c}.ilike.%${q}%`).join(",")
      );
    }
    return next;
  };

  let query = withFilters(supabase.from("self_audit_technical_inquiries").select("*", { count: "exact" }))
    .order("vehicle_location", { ascending: true })
    .order("updated_at", { ascending: false })
    .range(from, from + INQUIRY_PAGE_SIZE - 1);
  if (tab.statuses) query = query.in("status", tab.statuses);

  const countStatus = async (status: InquiryStatus) => {
    const c = withFilters(supabase.from("self_audit_technical_inquiries").select("id", { count: "exact", head: true })).eq("status", status);
    return (await c).count ?? 0;
  };
  const [{ data: inquiries, count }, nOpen, nAwaiting, nClosed, nCancelled, nVerify] = await Promise.all([
    query,
    countStatus("open"),
    countStatus("awaiting_workshop"),
    countStatus("closed"),
    countStatus("cancelled"),
    isBranch ? countStatus("pending_verification") : Promise.resolve(0),
  ]);
  const tabCount: Record<string, number> = { open: nOpen, awaiting: nAwaiting, closed: nClosed, cancelled: nCancelled, verify: nVerify, all: nOpen + nAwaiting + nClosed + nCancelled + nVerify };

  const ids = (inquiries ?? []).map((i) => i.id);
  const { data: comments } = ids.length ? await supabase.from("self_audit_technical_inquiry_comments").select("inquiry_id").eq("kind", "comment").eq("internal", false).in("inquiry_id", ids) : { data: [] as { inquiry_id: string }[] };
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
    if (systemFilter) sp.set("system", systemFilter);
    if (mine) sp.set("mine", "1");
    if ((over.page ?? 1) > 1) sp.set("page", String(over.page));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const filtered = !!(q || branchFilter || systemFilter || mine);
  const technicians = (techRows ?? []).map((t) => ({ id: t.id, name: t.full_name?.trim() || t.email }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Technical Inquiries</h1>
          <p className="text-sm text-neutral-600">
            {isBranch
              ? "Escalate a workshop problem to the technical team, follow their answer and reply."
              : "Workshop problems escalated to the technical team. Answer, ask for more, and close each case with the solution."}
          </p>
        </div>
        {isTeam && (
          <Link href={`${basePath}/reports`} className="rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-sm font-semibold text-neutral-800 shadow-sm transition-colors hover:bg-neutral-50">
            Reports
          </Link>
        )}
      </div>

      {viewSwitch}

      {role === "officer" && (
        <RoutingEditor
          branches={allBranches.filter((b) => b.active).map((b) => ({ id: b.id, name: b.name }))}
          technicians={technicians}
          routing={Object.fromEntries((routingRows ?? []).filter((r) => r.technician_id).map((r) => [r.branch_id, r.technician_id as string]))}
        />
      )}

      {newRequest}

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
          placeholder="Search work order, VIN, plate, fault, fault code, solution or part"
          aria-label="Search the inquiries"
          className="h-9 w-full max-w-sm rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-900 shadow-sm placeholder:text-neutral-500 focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
        />
        {isTeam && (
          <select name="branch" defaultValue={branchFilter} aria-label="Filter by branch" className={selectClass}>
            <option value="">All branches</option>
            {allBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <select name="system" defaultValue={systemFilter} aria-label="Filter by vehicle system" className={selectClass}>
          <option value="">All systems</option>
          {SYSTEMS.map((k) => (
            <option key={k} value={k}>
              {SYSTEM_LABEL[k]}
            </option>
          ))}
        </select>
        {role === "technical" && (
          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 text-sm text-neutral-800 shadow-sm">
            <input type="checkbox" name="mine" value="1" defaultChecked={mine} className="h-4 w-4 rounded border-neutral-300 text-brand focus:ring-brand/30" />
            My cases
          </label>
        )}
        <button type="submit" className="h-9 rounded-lg bg-brand px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-dark">
          Search
        </button>
        {filtered && (
          <Link href={tab.key === tabs[0].key ? basePath : `${basePath}?tab=${tab.key}`} className="h-9 rounded-lg px-2.5 text-sm leading-9 font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800">
            Reset
          </Link>
        )}
        <span className="ml-auto text-xs text-neutral-500">
          {total} case{total === 1 ? "" : "s"}
        </span>
      </form>

      {(inquiries ?? []).length === 0 ? (
        <p className="rounded-xl border border-neutral-200/70 bg-white p-6 text-center text-sm text-neutral-500 shadow-sm">{filtered ? "No cases match this search." : "No cases here."}</p>
      ) : (
        <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200/70 bg-white shadow-sm">
          {(inquiries ?? []).map((i) => {
            const status = i.status as InquiryStatus;
            const late = isLate(i.waiting_since, status);
            return (
              <li key={i.id}>
                <Link href={`${basePath}/${i.id}`} className="flex flex-col gap-1.5 px-4 py-3 transition-colors hover:bg-neutral-50">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-semibold text-neutral-900">{inquiryLabel(i.inquiry_no)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STATUS_BADGE[status]}`}>{STATUS_LABEL[status]}</span>
                    {i.vehicle_location === "in_workshop" && <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white">CAR IN WORKSHOP</span>}
                    {!isBranch && (
                      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700 ring-1 ring-neutral-200 ring-inset">{branchName.get(i.branch_id) ?? "Branch"}</span>
                    )}
                    <span className="rounded-full bg-neutral-50 px-2 py-0.5 text-[11px] font-medium text-neutral-600 ring-1 ring-neutral-200 ring-inset">
                      {SYSTEM_LABEL[i.system as InquirySystem] ?? i.system}
                    </span>
                    {i.waiting_since && !["closed", "cancelled"].includes(status) && (
                      <span className={`text-[11px] font-medium ${late ? "text-red-600" : "text-neutral-500"}`}>waiting {waitingText(i.waiting_since)}</span>
                    )}
                    <span className="ml-auto text-xs text-neutral-500">{dateLabel(i.updated_at)}</span>
                  </div>
                  <p className="text-sm text-neutral-800">
                    <span className="font-medium">{i.work_order_no}</span> <span className="text-neutral-500">·</span> {i.vehicle_model} <span className="text-neutral-500">·</span>{" "}
                    <span className="font-mono text-xs">{i.vin}</span>
                  </p>
                  <p className="line-clamp-2 text-sm text-neutral-600">{i.fault_complaint}</p>
                  <p className="text-xs text-neutral-500">
                    {i.assigned_to_name ? `Technical advisor: ${i.assigned_to_name}` : isTeam ? "Not assigned" : ""}
                    {(commentCount.get(i.id) ?? 0) > 0 && (
                      <>
                        {i.assigned_to_name || isTeam ? " · " : ""}
                        {commentCount.get(i.id)} comment{commentCount.get(i.id) === 1 ? "" : "s"}
                      </>
                    )}
                  </p>
                </Link>
              </li>
            );
          })}
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
