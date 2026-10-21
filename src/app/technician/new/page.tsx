import { requireRole } from "@/lib/auth";
import { TechClaimForm } from "@/components/tech-claims/claim-form";

export default async function NewTechClaimPage() {
  await requireRole("technician");
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold tracking-tight text-neutral-900">Submit claim</h1>
      <TechClaimForm />
    </div>
  );
}
