import { requireRole } from "@/lib/auth";
import { QcListPage } from "@/components/qc/qc-pages";

/** Quality control records (read only). */
export default async function QualityControlPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; branch?: string }> }) {
  const user = await requireRole("branch_admin");
  return <QcListPage user={user} base="/audit/quality-control" params={await searchParams} />;
}
