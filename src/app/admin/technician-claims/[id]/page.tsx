import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { getTechClaim } from "@/lib/tech-claims/server";
import { TechClaimDetailView } from "@/components/tech-claims/claim-detail";

export default async function OfficerTechClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("officer");
  const { id } = await params;
  const claim = await getTechClaim(user, id);
  if (!claim) notFound();
  return <TechClaimDetailView claim={claim} backHref="/admin/technician-claims" canReview={claim.status === "submitted" && !user.viewOnly} canEdit={false} showDrive />;
}
