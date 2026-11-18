import { requireAdvisorArea } from "@/lib/reception";
import { VorQuery } from "@/components/vor/vor-query";

export default async function AdvisorVorPartsPage() {
  await requireAdvisorArea();
  return <VorQuery />;
}
