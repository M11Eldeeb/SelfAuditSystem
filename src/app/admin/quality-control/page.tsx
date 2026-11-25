import { isTempQcTester, requireRole } from "@/lib/auth";
import { QcListPage } from "@/components/qc/qc-pages";

/** Quality control records (read only). */
export default async function QualityControlPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; branch?: string; qc?: string }> }) {
  const user = await requireRole("officer");
  return <QcListPage user={user} base="/admin/quality-control" params={await searchParams} newHref={isTempQcTester(user) ? "/qc/new" : undefined} />; // TEMPORARY: "+ New QC" for the QC test
}
