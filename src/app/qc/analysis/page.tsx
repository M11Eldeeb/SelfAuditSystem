import { requireRole } from "@/lib/auth";
import { QcAnalysisPage } from "@/components/qc/qc-pages";

export default async function QcAnalysis({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await requireRole("quality_controller");
  return <QcAnalysisPage user={user} base="/qc" params={await searchParams} newHref="/qc/new" />;
}
