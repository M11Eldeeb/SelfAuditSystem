import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { courtesyStaff } from "@/lib/courtesy/agreements-server";
import { canEditTerms } from "@/lib/courtesy/fleet-server";
import { currentTerms, termsHistory } from "@/lib/courtesy/terms-server";
import { TermsEditor } from "@/components/courtesy/terms-editor";

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" }) : "—");

/** The branch's courtesy car terms: edit (reception manager / warranty officer) and every earlier version with who changed it. */
export async function TermsTab({ base, branch }: { base: string; branch?: string }) {
  const s = await courtesyStaff();
  const { data: branches } = await createAdminClient().from("self_audit_branches").select("id, name").eq("active", true).order("name");
  const branchId = s.branchId ?? (branches ?? []).find((b) => b.id === branch)?.id ?? branches?.[0]?.id ?? null;
  if (!branchId) return <p className="text-sm text-neutral-500">No branch.</p>;
  const [now, history] = await Promise.all([currentTerms(branchId), termsHistory(branchId)]);
  const canEdit = canEditTerms(s.user);
  const branchName = (branches ?? []).find((b) => b.id === branchId)?.name ?? "";

  return (
    <div className="space-y-4">
      {!s.branchId && (
        <div className="flex flex-wrap gap-1.5">
          {(branches ?? []).map((b) => (
            <Link key={b.id} href={`${base}?tab=terms&branch=${b.id}`} className={`rounded-full px-3 py-1 text-[13px] font-semibold ring-1 ${b.id === branchId ? "bg-neutral-900 text-white ring-neutral-900" : "bg-white text-neutral-800 ring-black/10 hover:bg-neutral-50"}`}>
              {b.name}
            </Link>
          ))}
        </div>
      )}
      <div className="rounded-xl bg-white px-4 py-3 text-sm shadow-sm ring-1 ring-neutral-200/70">
        <b>{branchName}</b> -{" "}
        {now.id ? (
          <>
            version {now.version}, saved {fmt(now.created_at)} by {now.created_by_name}
          </>
        ) : (
          "the standard terms (not changed for this branch yet)"
        )}
        . Customers read and sign the current version; every agreement keeps the version its customer signed.
        {!canEdit && <span className="block text-xs text-neutral-500">Only the service manager, the reception manager or a warranty officer can change them.</span>}
      </div>

      <TermsEditor key={`${branchId}:${now.id ?? "std"}`} branchId={branchId} initial={now.terms} canEdit={canEdit} />

      <section className="space-y-2">
        <h2 className="text-base font-bold text-neutral-900">History of changes</h2>
        {history.length === 0 && <p className="rounded-xl bg-white px-4 py-3 text-sm text-neutral-500 shadow-sm ring-1 ring-neutral-200/70">No change yet - the standard terms are used.</p>}
        <ol className="space-y-2">
          {history.map((v) => (
            <li key={v.id} className="rounded-xl bg-white shadow-sm ring-1 ring-neutral-200/70">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 text-sm">
                  <b>Version {v.version}</b>
                  <span className="text-neutral-600">{v.note}</span>
                  <span className="ml-auto text-xs text-neutral-500">
                    {v.created_by_name} · {fmt(v.created_at)} · {v.terms.length} terms
                  </span>
                </summary>
                <ol className="space-y-2 border-t border-neutral-100 px-4 py-3 text-xs">
                  {v.terms.map((t, i) => (
                    <li key={i} className="grid gap-2 md:grid-cols-2">
                      <span>
                        <b>{i + 1}-</b> {t.en}
                      </span>
                      <span dir="rtl">
                        <b>{i + 1}-</b> {t.ar}
                      </span>
                    </li>
                  ))}
                </ol>
              </details>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
