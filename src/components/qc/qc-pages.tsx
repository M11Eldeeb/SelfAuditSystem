import { notFound } from "next/navigation";
import type { CurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { countQc, getQcAnalysis, getQcDetail, listQc, qcBranchScope } from "@/lib/qc/server";
import { parseQcRange } from "@/lib/qc/range";
import { QcDetailView, QcList, QcTabs } from "./qc-views";
import { QcAnalysisView, QcRangePills, qcPeriodLabel } from "./qc-analysis";

// The QC pages every viewer shares: the records list, one QC and the analysis. `base` is the page, e.g. /audit/quality-control.

const UUID = /^[0-9a-f-]{36}$/i;

async function allBranches() {
  const { data } = await createAdminClient().from("self_audit_branches").select("id, name").eq("active", true).order("name");
  return data ?? [];
}

export async function QcListPage({ user, base, params, newHref }: { user: CurrentUser; base: string; params: { status?: string; q?: string; branch?: string; qc?: string }; newHref?: string }) {
  const status = params.status ?? "failed";
  // The period (by the day the QC form was submitted): the same buttons as the Quality Dashboard; every QC unless one is picked.
  const range = parseQcRange(params.qc, "all");
  const all = !qcBranchScope(user);
  const branchId = all && params.branch && UUID.test(params.branch) ? params.branch : undefined;
  const [rows, counts, branches] = await Promise.all([listQc(user, { status, q: params.q, branchId, range }), countQc(user, range), all ? allBranches() : Promise.resolve([])]);
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
      <QcList base={base} rows={rows} tabs={tabs} active={status} q={params.q} showBranch={all} extraParams={{ ...(branchId ? { branch: branchId } : {}), qc: range }} />
    </div>
  );
}

export async function QcDetailPage({ user, base, id, retest }: { user: CurrentUser; base: string; id: string; retest?: (qc: NonNullable<Awaited<ReturnType<typeof getQcDetail>>>) => React.ReactNode }) {
  const qc = await getQcDetail(user, id);
  if (!qc) notFound();
  return <QcDetailView qc={qc} back={base} retest={retest?.(qc)} />;
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
