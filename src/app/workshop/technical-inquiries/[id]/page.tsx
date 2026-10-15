import { requireAnyRole } from "@/lib/auth";
import { getInquiriesAccess } from "@/lib/technical-inquiries-server";
import { InquiryDetail } from "@/components/technical-inquiries/inquiry-detail";
import { InquiriesComingSoon } from "@/components/technical-inquiries/coming-soon";
import type { InquiryRole } from "@/lib/technical-inquiries";

// Server actions on this page may open up to 100 Google Drive upload sessions.
export const maxDuration = 60;

export default async function WorkshopInquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAnyRole(["workshop_supervisor", "team_leader"]);
  if ((await getInquiriesAccess(user)) !== "full") return <InquiriesComingSoon />;
  const { id } = await params;
  return <InquiryDetail role={user.role as InquiryRole} id={id} />;
}
