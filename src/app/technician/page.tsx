import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { countTechClaims, listTechClaims } from "@/lib/tech-claims/server";
import { TechClaimList } from "@/components/tech-claims/claim-list";

export default async function TechnicianHome({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const user = await requireRole("technician");
  const { status = "all", q } = await searchParams;
  const [claims, counts] = await Promise.all([listTechClaims(user, { status, q }), countTechClaims(user)]);
  const tabs = [
    { key: "all", label: "All" },
    { key: "returned", label: "To correct", count: counts.returned },
    { key: "uploading", label: "Not sent", count: counts.uploading },
    { key: "submitted", label: "Waiting", count: counts.submitted },
    { key: "approved", label: "Approved", count: counts.approved },
    { key: "rejected", label: "Rejected", count: counts.rejected },
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight text-neutral-900">My claims</h1>
        <Link href="/technician/new" className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark">
          + Submit claim
        </Link>
      </div>
      {counts.returned > 0 && status === "all" && (
        <Link href="/technician?status=returned" className="block rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-900 ring-1 ring-amber-200">
          {counts.returned} claim{counts.returned === 1 ? " was" : "s were"} returned to you - open to correct and send again.
        </Link>
      )}
      <TechClaimList base="/technician" claims={claims} tabs={tabs} active={status} q={q} />
    </div>
  );
}
