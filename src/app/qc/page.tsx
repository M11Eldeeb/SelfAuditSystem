import { requireRole } from "@/lib/auth";
import { QcListPage } from "@/components/qc/qc-pages";

export default async function QcHome({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const user = await requireRole("quality_controller");
  return <QcListPage user={user} base="/qc" params={await searchParams} newHref="/qc/new" />;
}
