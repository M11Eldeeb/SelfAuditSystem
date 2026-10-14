import { requireRole } from "@/lib/auth";
import { getInquiriesAccess } from "@/lib/technical-inquiries-server";
import { InquiryList, type InquiryListParams } from "@/components/technical-inquiries/inquiry-list";
import { InquiriesComingSoon } from "@/components/technical-inquiries/coming-soon";

// Server actions on this page may open up to 20 Google Drive upload sessions.
export const maxDuration = 60;

export default async function AuditTechnicalInquiriesPage({ searchParams }: { searchParams: Promise<InquiryListParams> }) {
  const user = await requireRole("branch_admin");
  if ((await getInquiriesAccess(user)) !== "full") return <InquiriesComingSoon />;
  return <InquiryList user={user} role="branch_admin" params={await searchParams} />;
}
