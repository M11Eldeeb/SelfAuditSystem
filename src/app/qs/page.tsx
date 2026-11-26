import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getQcAnalysis } from "@/lib/qc/server";
import { parseQcRange } from "@/lib/qc/range";
import { QcTabs } from "@/components/qc/qc-views";
import { QcAnalysisView, QcRangePills, qcPeriodLabel } from "@/components/qc/qc-analysis";

const UUID = /^[0-9a-f-]{36}$/i;

/** The quality supervisor's Quality Dashboard: every branch, or one branch picked. */
export default async function QsDashboard({ searchParams }: { searchParams: Promise<{ qc?: string; branch?: string }> }) {
  const user = await requireRole("quality_supervisor");
  const params = await searchParams;
  const range = parseQcRange(params.qc);
  const branchId = params.branch && UUID.test(params.branch) ? params.branch : undefined;
  const [a, { data: branches }] = await Promise.all([
    getQcAnalysis(user, { range, branchId }),
    createAdminClient().from("self_audit_branches").select("id, name").eq("active", true).order("name"),
  ]);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold tracking-tight text-neutral-900">Quality Control</h1>
      <QcTabs base="/qs/reports" active="analysis" />
      <QcRangePills action="/qs" range={range} branches={branches ?? []} branchId={branchId} />
      <p className="text-sm text-neutral-500">Quality control checks by the day the QC form was submitted: {qcPeriodLabel(a)}.</p>
      <QcAnalysisView a={a} showBranches={!branchId} recordsHref="/qs/reports" />
    </div>
  );
}
