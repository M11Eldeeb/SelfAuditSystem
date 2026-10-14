import { requireRole } from "@/lib/auth";
import { InquiryList, type InquiryListParams } from "@/components/technical-inquiries/inquiry-list";

// Server actions on this page may open up to 20 Google Drive upload sessions.
export const maxDuration = 60;

export default async function AdminTechnicalInquiriesPage({ searchParams }: { searchParams: Promise<InquiryListParams> }) {
  const user = await requireRole("officer");
  return <InquiryList user={user} role="officer" params={await searchParams} />;
}
