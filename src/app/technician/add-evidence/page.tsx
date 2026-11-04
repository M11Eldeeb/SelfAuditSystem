import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTechLang } from "@/lib/i18n/tech-server";
import { techT } from "@/lib/i18n/tech";
import { findMyClaimsByWorkOrder } from "@/app/actions/tech-claims";
import { TechClaimForm } from "@/components/tech-claims/claim-form";
import { StatusPill, fmtDateTime } from "@/components/tech-claims/status";

/**
 * Technicians: extra evidence for a claim already sent - type the work order number, pick the claim (when there is
 * more than one), attach the files. They are stamped and uploaded as for a new claim and go into that claim's folder.
 */
export default async function AddEvidencePage({ searchParams }: { searchParams: Promise<{ wo?: string; claim?: string }> }) {
  const user = await requireRole("technician");
  const [{ wo, claim }, lang, { data: branch }] = await Promise.all([
    searchParams,
    getTechLang(),
    createAdminClient().from("self_audit_branches").select("code").eq("id", user.branch_id ?? "00000000-0000-0000-0000-000000000000").maybeSingle(),
  ]);
  const t = techT(lang);
  const digits = (wo ?? "").replace(/\D/g, "");
  const found = digits ? await findMyClaimsByWorkOrder(digits) : null;
  const list = found?.claims ?? [];
  const picked = list.find((c) => c.id === claim) ?? (list.length === 1 ? list[0] : null);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-neutral-900">{t.addEvidence}</h1>
        <p className="text-sm text-neutral-600">{t.addEvidenceIntro}</p>
      </div>

      <form method="get" className="flex gap-2 rounded-xl bg-white p-3 shadow-sm ring-1 ring-neutral-200/70">
        <div dir="ltr" className="flex min-w-0 flex-1 items-stretch overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-sm focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15">
          {branch?.code && <span className="flex items-center bg-neutral-100 px-3 font-mono text-base font-semibold text-neutral-700">{branch.code}-</span>}
          <input name="wo" defaultValue={digits} inputMode="numeric" pattern="[0-9]*" placeholder="123456" aria-label={t.workOrder} className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-base focus:outline-none" />
        </div>
        <button type="submit" className="rounded-lg bg-brand px-4 py-2 text-base font-semibold text-white hover:bg-brand-dark">
          {t.findClaim}
        </button>
      </form>

      {found?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{found.error}</p>}
      {digits && !found?.error && list.length === 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t.noClaimFound}</p>}

      {list.length > 1 && (
        <div className="space-y-2">
          <div className="text-sm font-semibold text-neutral-900">{t.chooseClaim}</div>
          {list.map((c) => (
            <Link
              key={c.id}
              href={`/technician/add-evidence?wo=${digits}&claim=${c.id}`}
              className={`flex items-center justify-between gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ${picked?.id === c.id ? "ring-brand" : "ring-neutral-200/70"}`}
            >
              <span>
                <span className="font-semibold">{c.claimNo}</span> <span className="text-sm text-neutral-500">· {c.workOrder}</span>
                <span className="block text-xs text-neutral-500" dir="ltr">
                  {fmtDateTime(c.submittedAt)}
                </span>
              </span>
              <StatusPill status={c.status as "submitted"} lang={lang} />
            </Link>
          ))}
        </div>
      )}

      {picked && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-neutral-200/70">
            <span>
              <span className="text-xs text-neutral-500">{t.addToClaim}</span>
              <span className="block font-semibold">
                {picked.claimNo} · {picked.workOrder}
              </span>
            </span>
            <StatusPill status={picked.status as "submitted"} lang={lang} />
          </div>
          <TechClaimForm key={picked.id} who={user.full_name ?? user.email} claimId={picked.id} lang={lang} branchCode={branch?.code ?? ""} evidenceOnly />
        </div>
      )}
    </div>
  );
}
