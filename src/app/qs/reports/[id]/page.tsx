import { requireRole } from "@/lib/auth";
import { QcDetailPage } from "@/components/qc/qc-pages";

export default async function QsReport({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("quality_supervisor");
  const { id } = await params;
  return <QcDetailPage user={user} base="/qs/reports" id={id} />;
}
