import { requireRole } from "@/lib/auth";
import { InquiryList, type InquiryListParams } from "@/components/technical-inquiries/inquiry-list";

// Server actions on this page may open up to 20 Google Drive upload sessions.
export const maxDuration = 60;

export default async function TechnicalInquiriesPage({ searchParams }: { searchParams: Promise<InquiryListParams> }) {
  const user = await requireRole("technical");
  return <InquiryList user={user} role="technical" params={await searchParams} />;
}
