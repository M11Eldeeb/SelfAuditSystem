import { requireRole } from "@/lib/auth";
import { RejectedClaimsList, type ListParams } from "@/components/rejected-claims/rejected-claims-list";

// Server actions on this page may open up to 20 Google Drive upload sessions.
export const maxDuration = 60;

export default async function AdminRejectedClaimsPage({ searchParams }: { searchParams: Promise<ListParams> }) {
  const user = await requireRole("officer");
  return <RejectedClaimsList user={user} role="officer" params={await searchParams} />;
}
