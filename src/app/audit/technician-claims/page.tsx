import { requireRole } from "@/lib/auth";
import { countTechClaims, listTechClaims } from "@/lib/tech-claims/server";
import { TechClaimList } from "@/components/tech-claims/claim-list";

/** The branch's warranty admin: technician claims of this branch - the review queue first. */
export default async function BranchTechClaimsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const user = await requireRole("branch_admin");
  const { status = "submitted", q } = await searchParams;
  const [claims, counts] = await Promise.all([listTechClaims(user, { status, q }), countTechClaims(user)]);
  const tabs = [
    { key: "submitted", label: "To review", count: counts.submitted },
    { key: "returned", label: "Returned", count: counts.returned },
    { key: "approved", label: "Approved", count: counts.approved },
    { key: "rejected", label: "Rejected", count: counts.rejected },
    { key: "all", label: "All" },
  ];
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold tracking-tight text-neutral-900">Technician Claims</h1>
      <TechClaimList base="/audit/technician-claims" claims={claims} tabs={tabs} active={status} q={q} showTechnician />
    </div>
  );
}
