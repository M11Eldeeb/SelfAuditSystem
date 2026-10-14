import { requireRole } from "@/lib/auth";
import { InquiryReports, type ReportParams } from "@/components/technical-inquiries/inquiry-reports";

export default async function AdminTechnicalInquiryReportsPage({ searchParams }: { searchParams: Promise<ReportParams> }) {
  await requireRole("officer");
  return <InquiryReports role="officer" params={await searchParams} />;
}
