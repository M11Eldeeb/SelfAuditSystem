import { requireRole } from "@/lib/auth";
import { qcFormOptions } from "@/app/actions/qc";
import { QcNewForm, type NewQcDraftData } from "@/components/qc/qc-form";
import { getQcDraft } from "@/lib/qc/server";

/** A new QC - or a saved one (?draft=…) to complete. */
export default async function NewQcPage({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  const user = await requireRole("quality_controller");
  const { draft: draftId } = await searchParams;
  const [options, draft] = await Promise.all([qcFormOptions(), draftId ? getQcDraft(user, draftId) : Promise.resolve(null)]);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold tracking-tight text-neutral-900">{draft ? `Saved QC${draft.wip ? ` · WIP ${draft.wip}` : ""}` : "New QC"}</h1>
      <QcNewForm key={draft?.id ?? "new"} options={options} draft={draft && draft.kind === "new" ? { id: draft.id, data: draft.data as NewQcDraftData, savedAt: draft.updatedAt } : null} />
    </div>
  );
}
