import { createAdminClient } from "@/lib/supabase/admin";
import { branchSettings } from "@/lib/queue/server";
import { queuePage } from "@/lib/queue/pages";
import { BranchTabs } from "@/components/queue/branch-tabs";
import { SettingsForm } from "@/components/queue/settings-form";

export default async function QueueSettingsPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { a, branch } = await queuePage(code, "manager");
  const [settings, { data: row }] = await Promise.all([
    branchSettings(branch.id),
    createAdminClient().from("self_audit_queue_settings").select("updated_by, updated_at").eq("branch_id", branch.id).maybeSingle(),
  ]);
  const updated = row ? `Last saved by ${row.updated_by ?? "?"}, ${new Date(row.updated_at).toLocaleString("en-GB", { timeZone: "Asia/Riyadh", dateStyle: "medium", timeStyle: "short" })}` : null;
  return (
    <>
      <BranchTabs code={branch.queue_code} name={branch.name} active="settings" manager role={a.role} />
      <SettingsForm branchId={branch.id} initial={settings} updated={updated} />
    </>
  );
}
