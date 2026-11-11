import { requireRole } from "@/lib/auth";
import { QcAnalysisPage } from "@/components/qc/qc-pages";

export default async function QualityControlAnalysisPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; branch?: string }> }) {
  const user = await requireRole("workshop_supervisor");
  return <QcAnalysisPage user={user} base="/workshop/quality-control" params={await searchParams} />;
}
