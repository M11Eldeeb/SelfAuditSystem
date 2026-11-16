import { requireRole } from "@/lib/auth";
import { qcFormOptions } from "@/app/actions/qc";
import { QcDetailPage } from "@/components/qc/qc-pages";
import { QcRetestForm, type RetestDraftData } from "@/components/qc/qc-form";
import { getRetestDraft } from "@/lib/qc/server";

export default async function QcRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("quality_controller");
  const { id } = await params;
  // The retest form's lists are only needed for a failed QC: loaded alongside the QC, never in front of it.
  const options = qcFormOptions();
  options.catch(() => {});
  const draft = getRetestDraft(user, id);
  draft.catch(() => null);
  return (
    <QcDetailPage
      user={user}
      base="/qc"
      id={id}
      retest={async (qc) =>
        qc.status === "failed" ? (
          <QcRetestForm
            checkId={qc.id}
            options={await options}
            lastTechnicians={qc.tests[qc.tests.length - 1]?.technicians ?? []}
            repairType={qc.repair_type}
            lastChecklist={[...qc.tests].reverse().find((t) => t.checklist)?.checklist ?? null}
            draft={await draft.then((d) => (d ? { data: d.data as RetestDraftData, savedAt: d.updatedAt } : null)).catch(() => null)}
          />
        ) : null
      }
    />
  );
}
