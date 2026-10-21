import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { countTechClaims, listTechClaims } from "@/lib/tech-claims/server";
import { TechClaimList } from "@/components/tech-claims/claim-list";

/** Warranty officers: every branch's technician claims. */
export default async function OfficerTechClaimsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; branch?: string }> }) {
  const user = await requireRole("officer");
  const { status = "submitted", q, branch } = await searchParams;
  const [claims, counts, { data: branches }] = await Promise.all([
    listTechClaims(user, { status, q, branchId: branch }),
    countTechClaims(user, branch),
    createAdminClient().from("self_audit_branches").select("id, name").eq("active", true).order("name"),
  ]);
  const tabs = [
    { key: "submitted", label: "Waiting for review", count: counts.submitted },
    { key: "returned", label: "Returned", count: counts.returned },
    { key: "approved", label: "Approved", count: counts.approved },
    { key: "rejected", label: "Rejected", count: counts.rejected },
    { key: "all", label: "All" },
  ];
  const branchHref = (id?: string) => `/admin/technician-claims?${new URLSearchParams({ status, ...(id ? { branch: id } : {}) }).toString()}`;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold tracking-tight text-neutral-900">Technician Claims</h1>
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href={branchHref()} className={`rounded-lg px-3 py-1 ${!branch ? "bg-neutral-800 text-white" : "bg-white ring-1 ring-neutral-200"}`}>
          All branches
        </Link>
        {(branches ?? []).map((b) => (
          <Link key={b.id} href={branchHref(b.id)} className={`rounded-lg px-3 py-1 ${branch === b.id ? "bg-neutral-800 text-white" : "bg-white ring-1 ring-neutral-200"}`}>
            {b.name}
          </Link>
        ))}
      </div>
      <TechClaimList base="/admin/technician-claims" claims={claims} tabs={tabs} active={status} q={q} showBranch showTechnician extraParams={branch ? { branch } : {}} />
    </div>
  );
}
