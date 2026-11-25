import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { QcListPage } from "@/components/qc/qc-pages";
import { listQcDrafts } from "@/lib/qc/server";
import { DeleteDraftButton } from "@/components/qc/delete-draft-button";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" });

export default async function QcHome({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; qc?: string }> }) {
  const user = await requireRole("quality_controller");
  const drafts = await listQcDrafts(user);
  return (
    <div className="space-y-5">
      {drafts.length > 0 && (
        <section className="space-y-2 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
          <h2 className="text-sm font-bold text-amber-900">Saved - not submitted yet ({drafts.length})</h2>
          <ul className="space-y-2">
            {drafts.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2.5 ring-1 ring-amber-200">
                <div className="min-w-0">
                  <div className="font-semibold text-neutral-900">{d.wip ? `WIP ${d.wip}` : "No WIP yet"}</div>
                  <div className="text-xs text-neutral-500">Saved {when(d.updatedAt)}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <DeleteDraftButton id={d.id} />
                  <Link href={`/qc/new?draft=${d.id}`} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white">
                    Continue
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <QcListPage user={user} base="/qc" params={await searchParams} newHref="/qc/new" />
    </div>
  );
}
