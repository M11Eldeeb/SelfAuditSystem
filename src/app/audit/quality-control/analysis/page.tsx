import { requireRole } from "@/lib/auth";
import { QcAnalysisPage } from "@/components/qc/qc-pages";

export default async function QualityControlAnalysisPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; branch?: string }> }) {
  const user = await requireRole("branch_admin");
  return <QcAnalysisPage user={user} base="/audit/quality-control" params={await searchParams} />;
}
