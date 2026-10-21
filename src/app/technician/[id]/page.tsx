import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { getTechClaim } from "@/lib/tech-claims/server";
import { TechClaimDetailView } from "@/components/tech-claims/claim-detail";

export default async function TechnicianClaimPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sent?: string; interrupted?: string }> }) {
  const user = await requireRole("technician");
  const [{ id }, { sent, interrupted }] = await Promise.all([params, searchParams]);
  const claim = await getTechClaim(user, id);
  if (!claim) notFound();
  const editable = claim.status === "uploading" || claim.status === "returned";
  return (
    <div className="space-y-4">
      {sent && claim.status === "submitted" && <p className="rounded-xl bg-emerald-50 p-3 text-sm font-medium text-emerald-900">Sent to the warranty admin.</p>}
      {claim.status === "uploading" && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          {interrupted ? "Not all files were sent. " : ""}This claim is not sent yet - add the missing files and press &quot;Send to warranty admin&quot;.
        </p>
      )}
      <TechClaimDetailView claim={claim} backHref="/technician" canReview={false} canEdit={editable} showDrive={false} />
    </div>
  );
}
