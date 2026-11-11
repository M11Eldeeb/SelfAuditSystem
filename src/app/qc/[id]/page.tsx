import { requireRole } from "@/lib/auth";
import { qcFormOptions } from "@/app/actions/qc";
import { QcDetailPage } from "@/components/qc/qc-pages";
import { QcRetestForm } from "@/components/qc/qc-form";

export default async function QcRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("quality_controller");
  const { id } = await params;
  const options = await qcFormOptions();
  return (
    <QcDetailPage
      user={user}
      base="/qc"
      id={id}
      retest={(qc) =>
        qc.status === "failed" ? (
          <QcRetestForm
            checkId={qc.id}
            options={options}
            lastTechnicians={qc.tests[qc.tests.length - 1]?.technicians ?? []}
            repairType={qc.repair_type}
            lastChecklist={[...qc.tests].reverse().find((t) => t.checklist)?.checklist ?? null}
          />
        ) : null
      }
    />
  );
}
