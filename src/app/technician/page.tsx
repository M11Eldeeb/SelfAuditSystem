import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { countTechClaims, listTechClaims } from "@/lib/tech-claims/server";
import { TechClaimList } from "@/components/tech-claims/claim-list";
import { getTechLang } from "@/lib/i18n/tech-server";
import { techT } from "@/lib/i18n/tech";

export default async function TechnicianHome({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const user = await requireRole("technician");
  const { status = "all", q } = await searchParams;
  const lang = await getTechLang();
  const t = techT(lang);
  const [claims, counts] = await Promise.all([listTechClaims(user, { status, q }), countTechClaims(user)]);
  const tabs = [
    { key: "all", label: t.all },
    { key: "uploading", label: t.drafts, count: counts.uploading },
    { key: "returned", label: t.toCorrect, count: counts.returned },
    { key: "submitted", label: t.waiting, count: counts.submitted },
    { key: "approved", label: t.approved, count: counts.approved },
    { key: "rejected", label: t.rejected, count: counts.rejected },
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight text-neutral-900">{t.myClaims}</h1>
        <Link href="/technician/new" className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark">
          + {t.newClaim}
        </Link>
      </div>
      {counts.returned > 0 && status === "all" && (
        <Link href="/technician?status=returned" className="block rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-900 ring-1 ring-amber-200">
          {t.returnedBanner(counts.returned)}
        </Link>
      )}
      <TechClaimList base="/technician" claims={claims} tabs={tabs} active={status} q={q} lang={lang} />
    </div>
  );
}
