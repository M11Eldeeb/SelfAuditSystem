import { notFound } from "next/navigation";
import type { CurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { countQc, getQcAnalysis, getQcDetail, listQc, qcBranchScope } from "@/lib/qc/server";
import { parseQcRange } from "@/lib/qc/range";
import { QcDetailView, QcList, QcTabs } from "./qc-views";
import { QcAnalysisView, QcRangePills, qcPeriodLabel } from "./qc-analysis";
import { canCommentOnQc, listQcComments, qcExportMarks, type QcExportMark } from "@/lib/qc/supervisor";
import { QcComments } from "./qc-comments";
import { ExportedPill, QcExportButton } from "./qc-export";

const exportedTitle = (m: QcExportMark) =>
  `${m.format === "pdf" ? "PDF" : "Excel"} by ${m.by ?? "—"}, ${new Date(m.at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" })}`;

// The QC pages every viewer shares: the records list, one QC and the analysis. `base` is the page, e.g. /audit/quality-control.

const UUID = /^[0-9a-f-]{36}$/i;
const SHORT_LIST = 10;

async function allBranches() {
  const { data } = await createAdminClient().from("self_audit_branches").select("id, name").eq("active", true).order("name");
  return data ?? [];
}

export async function QcListPage({ user, base, params, newHref }: { user: CurrentUser; base: string; params: { status?: string; q?: string; branch?: string; qc?: string; more?: string }; newHref?: string }) {
  const status = params.status ?? "failed";
  // The period (by the day the QC form was submitted): the same buttons as the Quality Dashboard; every QC unless one is picked.
  const range = parseQcRange(params.qc, "all");
  const all = !qcBranchScope(user);
  const branchId = all && params.branch && UUID.test(params.branch) ? params.branch : undefined;
  // The last 10 records first; "Show more" lists them all (one more is read to know whether there are more).
  const more = params.more === "1";
  const [found, counts, branches] = await Promise.all([listQc(user, { status, q: params.q, branchId, range, limit: more ? 300 : SHORT_LIST + 1 }), countQc(user, range), all ? allBranches() : Promise.resolve([])]);
  const rows = more ? found : found.slice(0, SHORT_LIST);
  const listParams = { ...(branchId ? { branch: branchId } : {}), qc: range };
  const moreParams = new URLSearchParams({ ...listParams, status, more: "1" });
  if (params.q) moreParams.set("q", params.q);
  const moreHref = !more && found.length > SHORT_LIST ? `${base}?${moreParams.toString()}` : undefined;
  // The quality supervisor exports the reports: the list marks the ones exported already.
  const supervisor = user.role === "quality_supervisor";
  const marks = supervisor ? await qcExportMarks(rows.map((r) => r.id)) : null;
  const exported = marks ? Object.fromEntries([...marks].map(([id, m]) => [id, exportedTitle(m)])) : undefined;
  const exportParams = new URLSearchParams({ ...listParams, status });
  if (params.q) exportParams.set("q", params.q);
  const tabs = [
    { key: "failed", label: "Waiting for retest", count: counts.failed },
    { key: "closed", label: "Closed", count: counts.closed },
    { key: "closed_failed", label: "Closed as failed", count: counts.closedFailed },
    { key: "all", label: "All" },
  ];
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold tracking-tight text-neutral-900">Quality Control</h1>
      <QcTabs base={base} active="list" newHref={newHref} />
      <QcRangePills action={base} range={range} extra={{ status, ...(params.q ? { q: params.q } : {}) }} branchId={branchId} />
      {all && (
        <form action={base} className="flex gap-2">
          <input type="hidden" name="status" value={status} />
          <input type="hidden" name="qc" value={range} />
          <select name="branch" defaultValue={branchId ?? ""} className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm">
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <button className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700">Show</button>
        </form>
      )}
      {supervisor && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 shadow-sm ring-1 ring-neutral-200/70">
          <span className="me-1 text-sm font-semibold text-neutral-700">Export this list (Excel):</span>
          <QcExportButton href={`/api/qc/excel?${exportParams.toString()}&new=1`} label="Not exported yet" primary />
          <QcExportButton href={`/api/qc/excel?${exportParams.toString()}`} label="All" />
        </div>
      )}
      <QcList base={base} rows={rows} tabs={tabs} active={status} q={params.q} showBranch={all} extraParams={listParams} moreHref={moreHref} exported={exported} />
    </div>
  );
}

export async function QcDetailPage({ user, base, id, retest }: { user: CurrentUser; base: string; id: string; retest?: (qc: NonNullable<Awaited<ReturnType<typeof getQcDetail>>>) => React.ReactNode }) {
  const qc = await getQcDetail(user, id);
  if (!qc) notFound();
  const supervisor = user.role === "quality_supervisor";
  const [comments, marks] = await Promise.all([listQcComments(qc.id), supervisor ? qcExportMarks([qc.id]) : Promise.resolve(null)]);
  const mark = marks?.get(qc.id);
  return (
    <div className="space-y-4">
      {supervisor && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 shadow-sm ring-1 ring-neutral-200/70">
          <span className="me-1 text-sm font-semibold text-neutral-700">Export this report:</span>
          <QcExportButton href={`/api/qc/report/${qc.id}?download=1`} label="PDF" primary />
          <QcExportButton href={`/api/qc/excel/${qc.id}`} label="Excel" />
          {mark && (
            <span className="flex items-center gap-2 text-xs text-neutral-500">
              <ExportedPill title={exportedTitle(mark)} /> {exportedTitle(mark)}
            </span>
          )}
        </div>
      )}
      <QcDetailView qc={qc} back={base} retest={retest?.(qc)} />
      <QcComments checkId={qc.id} comments={comments} canComment={canCommentOnQc(user)} />
    </div>
  );
}

export async function QcAnalysisPage({ user, base, params, newHref }: { user: CurrentUser; base: string; params: { qc?: string; branch?: string }; newHref?: string }) {
  // The same periods as the Quality Dashboard tab (counted on the day the QC form was submitted), so the two pages show the same numbers.
  const range = parseQcRange(params.qc);
  const all = !qcBranchScope(user);
  const branchId = all && params.branch && UUID.test(params.branch) ? params.branch : undefined;
  const [a, branches] = await Promise.all([getQcAnalysis(user, { range, branchId }), all ? allBranches() : Promise.resolve(undefined)]);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold tracking-tight text-neutral-900">Quality Control</h1>
      <QcTabs base={base} active="analysis" newHref={newHref} />
      <QcRangePills action={`${base}/analysis`} range={range} branches={branches} branchId={branchId} />
      <p className="text-sm text-neutral-500">Quality control checks by the day the QC form was submitted: {qcPeriodLabel(a)}.</p>
      <QcAnalysisView a={a} showBranches={all && !branchId} recordsHref={base} />
    </div>
  );
}
