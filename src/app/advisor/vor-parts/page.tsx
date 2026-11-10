import { requireRole } from "@/lib/auth";
import { VorQuery } from "@/components/vor/vor-query";

export default async function AdvisorVorPartsPage() {
  await requireRole("service_advisor");
  return <VorQuery />;
}
