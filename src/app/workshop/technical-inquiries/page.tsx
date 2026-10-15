import { requireAnyRole } from "@/lib/auth";
import { getInquiriesAccess } from "@/lib/technical-inquiries-server";
import { InquiryList, type InquiryListParams } from "@/components/technical-inquiries/inquiry-list";
import { InquiriesComingSoon } from "@/components/technical-inquiries/coming-soon";
import type { InquiryRole } from "@/lib/technical-inquiries";

// Server actions on this page may open up to 100 Google Drive upload sessions.
export const maxDuration = 60;

export default async function WorkshopInquiriesPage({ searchParams }: { searchParams: Promise<InquiryListParams> }) {
  const user = await requireAnyRole(["workshop_supervisor", "team_leader"]);
  if ((await getInquiriesAccess(user)) !== "full") return <InquiriesComingSoon />;
  return <InquiryList user={user} role={user.role as InquiryRole} params={await searchParams} />;
}
