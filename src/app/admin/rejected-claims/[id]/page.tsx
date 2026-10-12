import { requireRole } from "@/lib/auth";
import { RejectedClaimDetail } from "@/components/rejected-claims/rejected-claim-detail";

export default async function AdminRejectedClaimPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("officer");
  const { id } = await params;
  return <RejectedClaimDetail role="officer" id={id} />;
}
