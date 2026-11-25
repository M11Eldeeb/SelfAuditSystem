import { CourtesyAgreementPage } from "@/components/courtesy/agreements-page";
import { requireWorkshopCourtesy } from "../access";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkshopCourtesy();
  const { id } = await params;
  return <CourtesyAgreementPage id={id} base="/workshop/courtesy-cars" />;
}
