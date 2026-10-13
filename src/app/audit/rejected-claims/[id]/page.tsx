import { requireRole } from "@/lib/auth";
import { getRejectedClaimsAccess } from "@/lib/rejected-claims-server";
import { RejectedClaimDetail } from "@/components/rejected-claims/rejected-claim-detail";
import { RejectedClaimsComingSoon } from "@/components/rejected-claims/coming-soon";

// Server actions on this page may open up to 20 Google Drive upload sessions.
export const maxDuration = 60;

export default async function AuditRejectedClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("branch_admin");
  if ((await getRejectedClaimsAccess(user)) !== "full") return <RejectedClaimsComingSoon />;
  const { id } = await params;
  return <RejectedClaimDetail role="branch_admin" id={id} />;
}
