import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { getTechClaim } from "@/lib/tech-claims/server";
import { TechClaimDetailView } from "@/components/tech-claims/claim-detail";

export default async function BranchTechClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("branch_admin");
  const { id } = await params;
  const claim = await getTechClaim(user, id);
  if (!claim) notFound();
  return <TechClaimDetailView claim={claim} backHref="/audit/technician-claims" canReview={claim.status === "submitted" && !user.viewOnly} canEdit={false} showDrive />;
}
