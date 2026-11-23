import { requireRole } from "@/lib/auth";
import { CourtesyAgreementPage } from "@/components/courtesy/agreements-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("branch_admin");
  const { id } = await params;
  return <CourtesyAgreementPage id={id} base="/audit/courtesy-cars" />;
}
