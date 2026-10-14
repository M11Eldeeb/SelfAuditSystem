import { requireRole } from "@/lib/auth";
import { getInquiriesAccess } from "@/lib/technical-inquiries-server";
import { InquiryDetail } from "@/components/technical-inquiries/inquiry-detail";
import { InquiriesComingSoon } from "@/components/technical-inquiries/coming-soon";

// Server actions on this page may open up to 20 Google Drive upload sessions.
export const maxDuration = 60;

export default async function AuditTechnicalInquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("branch_admin");
  if ((await getInquiriesAccess(user)) !== "full") return <InquiriesComingSoon />;
  const { id } = await params;
  return <InquiryDetail role="branch_admin" id={id} />;
}
