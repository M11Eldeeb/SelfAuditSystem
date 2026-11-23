import type { Metadata } from "next";
import { branchByCode } from "@/lib/queue/server";
import { branchAdvisors } from "@/lib/courtesy/agreements-server";
import { CourtesyRequestForm } from "@/components/courtesy/request-form";
import { currentTerms } from "@/lib/courtesy/terms-server";
import { NotFoundCard } from "@/components/queue/not-found-card";

export const metadata: Metadata = { title: "MG Courtesy Car", robots: { index: false } };

/** The branch's courtesy car link / QR: the customer fills in his request and signs (no sign-in). `?a=` picks the advisor. */
export default async function CourtesyRequestPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ a?: string }> }) {
  const [{ code }, { a }] = await Promise.all([params, searchParams]);
  const branch = await branchByCode(code);
  if (!branch) return <NotFoundCard en="Branch not found - check the QR code." ar="الفرع غير موجود - تحقق من رمز QR." />;
  const [advisors, terms] = await Promise.all([branchAdvisors(branch.id), currentTerms(branch.id)]);
  return <CourtesyRequestForm code={code} branch={{ name: branch.name, name_ar: branch.name_ar }} advisors={advisors} presetAdvisor={a ?? null} terms={terms.terms} termsId={terms.id} />;
}
