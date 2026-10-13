import { requireRole } from "@/lib/auth";
import { RejectedClaimDetail } from "@/components/rejected-claims/rejected-claim-detail";

// Server actions on this page may open up to 20 Google Drive upload sessions.
export const maxDuration = 60;

export default async function AdminRejectedClaimPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("officer");
  const { id } = await params;
  return <RejectedClaimDetail role="officer" id={id} />;
}
