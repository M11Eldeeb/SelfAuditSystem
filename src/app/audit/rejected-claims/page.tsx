import { requireRole } from "@/lib/auth";
import { getRejectedClaimsAccess } from "@/lib/rejected-claims-server";
import { RejectedClaimsList, type ListParams } from "@/components/rejected-claims/rejected-claims-list";
import { RejectedClaimsComingSoon } from "@/components/rejected-claims/coming-soon";

// Server actions on this page may open up to 20 Google Drive upload sessions.
export const maxDuration = 60;

export default async function AuditRejectedClaimsPage({ searchParams }: { searchParams: Promise<ListParams> }) {
  const user = await requireRole("branch_admin");
  if ((await getRejectedClaimsAccess(user)) !== "full") return <RejectedClaimsComingSoon />;
  return <RejectedClaimsList user={user} role="branch_admin" params={await searchParams} />;
}
