import { requireRole } from "@/lib/auth";
import { VerificationRequestsSection } from "@/components/verification-codes/requests-section";
import { OcrAccuracy } from "@/components/verification-codes/ocr-accuracy";

export default async function VerificationCodesPage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const user = await requireRole("officer");
  const { open } = await searchParams;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">Verification code requests</h1>
        <p className="text-sm text-neutral-500">Enter the code and send - the requester gets it by e-mail and the request closes.</p>
      </div>
      <OcrAccuracy />
      <VerificationRequestsSection user={user} canAnswer openId={open} />
    </div>
  );
}
