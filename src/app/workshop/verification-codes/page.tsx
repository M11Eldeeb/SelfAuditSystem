import { requireAnyRole } from "@/lib/auth";
import { VerificationRequestForm } from "@/components/verification-codes/request-form";
import { VerificationRequestsSection } from "@/components/verification-codes/requests-section";

export default async function WorkshopVerificationCodesPage() {
  const user = await requireAnyRole(["workshop_supervisor", "team_leader"]);
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">Verification code request</h1>
        <p className="text-sm text-neutral-500">Take a photo of the VIN and the mileage - they are read automatically. The technical team e-mails you the code.</p>
      </div>
      <VerificationRequestForm />
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-900">Your branch&apos;s requests</h2>
        <VerificationRequestsSection user={user} canAnswer={false} />
      </div>
    </div>
  );
}
