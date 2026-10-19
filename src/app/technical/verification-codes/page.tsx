import { requireRole } from "@/lib/auth";
import { VerificationRequestsSection } from "@/components/verification-codes/requests-section";

export default async function VerificationCodesPage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const user = await requireRole("technical");
  const { open } = await searchParams;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">Verification code requests</h1>
        <p className="text-sm text-neutral-500">Enter the code and send - the requester gets it by e-mail and the request closes.</p>
      </div>
      <VerificationRequestsSection user={user} canAnswer openId={open} />
    </div>
  );
}
