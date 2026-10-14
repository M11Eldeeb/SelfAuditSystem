import { requireRole } from "@/lib/auth";
import { InquiryReports, type ReportParams } from "@/components/technical-inquiries/inquiry-reports";

export default async function TechnicalInquiryReportsPage({ searchParams }: { searchParams: Promise<ReportParams> }) {
  await requireRole("technical");
  return <InquiryReports role="technical" params={await searchParams} />;
}
