import { requireRole } from "@/lib/auth";
import { VorQuery } from "@/components/vor/vor-query";

export default async function AdminVorPartsPage() {
  await requireRole("officer");
  return <VorQuery />;
}
