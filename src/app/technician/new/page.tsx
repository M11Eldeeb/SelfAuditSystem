import { requireRole } from "@/lib/auth";
import { TechClaimForm } from "@/components/tech-claims/claim-form";
import { getTechLang } from "@/lib/i18n/tech-server";
import { techT } from "@/lib/i18n/tech";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function NewTechClaimPage() {
  const user = await requireRole("technician");
  const [lang, { data: branch }] = await Promise.all([
    getTechLang(),
    createAdminClient().from("self_audit_branches").select("code").eq("id", user.branch_id ?? "00000000-0000-0000-0000-000000000000").maybeSingle(),
  ]);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold tracking-tight text-neutral-900">{techT(lang).newClaim}</h1>
      <TechClaimForm who={user.full_name ?? user.email} lang={lang} branchCode={branch?.code ?? ""} />
    </div>
  );
}
