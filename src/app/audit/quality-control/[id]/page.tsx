import { requireRole } from "@/lib/auth";
import { QcDetailPage } from "@/components/qc/qc-pages";

export default async function QualityControlRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("branch_admin");
  const { id } = await params;
  return <QcDetailPage user={user} base="/audit/quality-control" id={id} />;
}
