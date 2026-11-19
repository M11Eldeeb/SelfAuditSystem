import { createAdminClient } from "@/lib/supabase/admin";
import { branchReceiving, branchSettings } from "@/lib/queue/server";
import { queuePage } from "@/lib/queue/pages";
import { BranchTabs } from "@/components/queue/branch-tabs";
import { SettingsForm } from "@/components/queue/settings-form";
import { HoursForm } from "@/components/queue/hours-form";

export default async function QueueSettingsPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { a, branch } = await queuePage(code, "manager");
  const [settings, hours, { data: row }] = await Promise.all([
    branchSettings(branch.id),
    branchReceiving(branch.id),
    createAdminClient().from("self_audit_queue_settings").select("updated_by, updated_at").eq("branch_id", branch.id).maybeSingle(),
  ]);
  const updated = row ? `Last saved by ${row.updated_by ?? "?"}, ${new Date(row.updated_at).toLocaleString("en-GB", { timeZone: "Asia/Riyadh", dateStyle: "medium", timeStyle: "short" })}` : null;
  return (
    <>
      <BranchTabs code={branch.queue_code} name={branch.name} active="settings" manager role={a.role} />
      <HoursForm branchId={branch.id} schedule={hours.schedule} override={hours.override} receiving={hours.receiving} />
      <h2 className="mb-3 mt-8 text-lg font-semibold text-neutral-900">Call next customer</h2>
      <SettingsForm branchId={branch.id} initial={settings} updated={updated} />
    </>
  );
}
