import { requireRole } from "@/lib/auth";
import { RejectedClaimsList, type ListParams } from "@/components/rejected-claims/rejected-claims-list";

export default async function AdminRejectedClaimsPage({ searchParams }: { searchParams: Promise<ListParams> }) {
  const user = await requireRole("officer");
  return <RejectedClaimsList user={user} role="officer" params={await searchParams} />;
}
