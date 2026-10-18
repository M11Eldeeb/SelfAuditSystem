import { createClient } from "@/lib/supabase/server";
import { getDriveStatus } from "@/lib/google-drive";
import { InternalAuditFilesPanel } from "./files-panel";

/** Officer-only: loads an internal audit's Drive files and renders the panel. */
export async function InternalAuditFilesSection({ auditId }: { auditId: string }) {
  const supabase = await createClient();
  const [{ data: audit }, { data: files }, drive] = await Promise.all([
    supabase.from("self_audit_internal_audits").select("status, branch_id, audit_date, date_to, created_at").eq("id", auditId).maybeSingle(),
    supabase
      .from("self_audit_internal_audit_files")
      .select("id, kind, file_name, drive_url, size_bytes, created_at")
      .eq("internal_audit_id", auditId)
      .order("created_at", { ascending: false }),
    getDriveStatus(),
  ]);
  if (!audit) return null;
  const { data: branch } = audit.branch_id ? await supabase.from("self_audit_branches").select("name").eq("id", audit.branch_id).maybeSingle() : { data: null };
  const iso = audit.audit_date ?? audit.date_to ?? audit.created_at;

  return (
    <InternalAuditFilesPanel
      auditId={auditId}
      files={files ?? []}
      finalized={audit.status === "finalized"}
      driveConnected={!!drive}
      folderLabel={`${branch?.name ?? "Branch"} / ${iso.slice(5, 7)}-${iso.slice(0, 4)}`}
    />
  );
}
