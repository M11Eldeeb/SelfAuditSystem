import { notFound } from "next/navigation";
import type { CurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { countQc, getQcAnalysis, getQcDetail, listQc, qcBranchScope, qcRange } from "@/lib/qc/server";
import { QcDetailView, QcList, QcTabs } from "./qc-views";
import { QcAnalysisView, QcRangeForm } from "./qc-analysis";

// The QC pages every viewer shares: the records list, one QC and the analysis. `base` is the page, e.g. /audit/quality-control.

const UUID = /^[0-9a-f-]{36}$/i;

async function allBranches() {
  const { data } = await createAdminClient().from("self_audit_branches").select("id, name").eq("active", true).order("name");
  return data ?? [];
}

export async function QcListPage({ user, base, params, newHref }: { user: CurrentUser; base: string; params: { status?: string; q?: string; branch?: string }; newHref?: string }) {
  const status = params.status ?? "failed";
  const all = !qcBranchScope(user);
  const branchId = all && params.branch && UUID.test(params.branch) ? params.branch : undefined;
  const [rows, counts, branches] = await Promise.all([listQc(user, { status, q: params.q, branchId }), countQc(user), all ? allBranches() : Promise.resolve([])]);
  const tabs = [
    { key: "failed", label: "Waiting for retest", count: counts.failed },
    { key: "passed", label: "Passed", count: counts.passed },
    { key: "all", label: "All" },
  ];
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold tracking-tight text-neutral-900">Quality Control</h1>
      <QcTabs base={base} active="list" newHref={newHref} />
      {all && (
        <form action={base} className="flex gap-2">
          <input type="hidden" name="status" value={status} />
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
      <QcList base={base} rows={rows} tabs={tabs} active={status} q={params.q} showBranch={all} extraParams={branchId ? { branch: branchId } : {}} />
    </div>
  );
}

export async function QcDetailPage({ user, base, id, retest }: { user: CurrentUser; base: string; id: string; retest?: (qc: NonNullable<Awaited<ReturnType<typeof getQcDetail>>>) => React.ReactNode }) {
  const qc = await getQcDetail(user, id);
  if (!qc) notFound();
  return <QcDetailView qc={qc} back={base} retest={retest?.(qc)} />;
}

export async function QcAnalysisPage({ user, base, params, newHref }: { user: CurrentUser; base: string; params: { from?: string; to?: string; branch?: string }; newHref?: string }) {
  const { from, to } = qcRange(params);
  const all = !qcBranchScope(user);
  const branchId = all && params.branch && UUID.test(params.branch) ? params.branch : undefined;
  const [a, branches] = await Promise.all([getQcAnalysis(user, { from, to, branchId }), all ? allBranches() : Promise.resolve(undefined)]);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold tracking-tight text-neutral-900">Quality Control</h1>
      <QcTabs base={base} active="analysis" newHref={newHref} />
      <QcRangeForm action={`${base}/analysis`} from={from} to={to} branches={branches} branchId={branchId} />
      <QcAnalysisView a={a} showBranches={all && !branchId} />
    </div>
  );
}
