import { requireRole } from "@/lib/auth";
import { InquiryDetail } from "@/components/technical-inquiries/inquiry-detail";

// Server actions on this page may open up to 20 Google Drive upload sessions.
export const maxDuration = 60;

export default async function TechnicalInquiryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ reply?: string }> }) {
  await requireRole("technical");
  const { id } = await params;
  const { reply } = await searchParams;
  // "View case" just opens it; "Edit & Reply" (?reply=1) takes the case (when nobody has it) and opens the reply tools.
  return <InquiryDetail role="technical" id={id} reply={reply === "1"} />;
}
