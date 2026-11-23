import { requireAdvisorArea } from "@/lib/reception";
import { CourtesyAgreementPage } from "@/components/courtesy/agreements-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireAdvisorArea();
  const { id } = await params;
  return <CourtesyAgreementPage id={id} base="/advisor/courtesy-cars" />;
}
