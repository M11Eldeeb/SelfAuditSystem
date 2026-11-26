import { requireRole } from "@/lib/auth";
import { QcListPage } from "@/components/qc/qc-pages";

/** The QC reports of every branch: export (PDF / Excel) and comment. */
export default async function QsReports({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; branch?: string; qc?: string; more?: string }> }) {
  const user = await requireRole("quality_supervisor");
  return <QcListPage user={user} base="/qs/reports" params={await searchParams} />;
}
