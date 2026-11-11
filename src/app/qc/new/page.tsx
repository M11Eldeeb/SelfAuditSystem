import { requireRole } from "@/lib/auth";
import { qcFormOptions } from "@/app/actions/qc";
import { QcNewForm } from "@/components/qc/qc-form";

export default async function NewQcPage() {
  await requireRole("quality_controller");
  const options = await qcFormOptions();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold tracking-tight text-neutral-900">New QC</h1>
      <QcNewForm options={options} />
    </div>
  );
}
