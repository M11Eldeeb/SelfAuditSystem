import { requireRole } from "@/lib/auth";
import { InquiryDetail } from "@/components/technical-inquiries/inquiry-detail";

// Server actions on this page may open up to 20 Google Drive upload sessions.
export const maxDuration = 60;

export default async function TechnicalInquiryPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("technical");
  const { id } = await params;
  return <InquiryDetail role="technical" id={id} />;
}
