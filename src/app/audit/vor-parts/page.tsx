import { requireRole } from "@/lib/auth";
import { VorQuery } from "@/components/vor/vor-query";

export default async function BranchVorPartsPage() {
  await requireRole("branch_admin");
  return <VorQuery />;
}
