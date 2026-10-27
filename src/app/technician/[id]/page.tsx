import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { getTechClaim } from "@/lib/tech-claims/server";
import { TechClaimDetailView } from "@/components/tech-claims/claim-detail";
import { getTechLang } from "@/lib/i18n/tech-server";
import { techT } from "@/lib/i18n/tech";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function TechnicianClaimPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sent?: string; saved?: string }> }) {
  const user = await requireRole("technician");
  const [{ id }, { sent, saved }, lang, { data: branch }] = await Promise.all([
    params,
    searchParams,
    getTechLang(),
    createAdminClient().from("self_audit_branches").select("code").eq("id", user.branch_id ?? "00000000-0000-0000-0000-000000000000").maybeSingle(),
  ]);
  const t = techT(lang);
  const claim = await getTechClaim(user, id);
  if (!claim) notFound();
  const editable = claim.status === "uploading" || claim.status === "returned";
  return (
    <div className="space-y-4">
      {sent && claim.status === "submitted" && <p className="rounded-xl bg-emerald-50 p-3 text-sm font-medium text-emerald-900">{t.sentBanner}</p>}
      {claim.status === "uploading" && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{saved ? t.savedBanner : t.draftBanner}</p>}
      <TechClaimDetailView claim={claim} backHref="/technician" canReview={false} canEdit={editable} showDrive={false} lang={lang} branchCode={branch?.code ?? ""} />
    </div>
  );
}
