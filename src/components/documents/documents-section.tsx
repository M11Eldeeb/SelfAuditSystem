import { createAdminClient } from "@/lib/supabase/admin";
import type { CurrentUser } from "@/lib/auth";
import { LIBRARIES, getDocsConnection } from "@/lib/documents/drive-docs";
import { DocumentsBrowser, type DocItem } from "./documents-browser";

/** Warranty and Technical Documents for any signed-in role (the page checked the role); officers can also manage. */
export async function DocumentsSection({ user, flag }: { user: CurrentUser; flag?: string }) {
  const admin = createAdminClient();
  const [connection, { data: sync }] = await Promise.all([getDocsConnection(), admin.from("self_audit_docs_sync").select("synced_at, files, error").eq("id", 1).maybeSingle()]);
  const items: DocItem[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data } = await admin
      .from("self_audit_docs_index")
      .select("drive_id, library, parent_id, name, mime_type, is_folder, size_bytes, modified_at")
      .order("name")
      .range(from, from + 999);
    for (const r of data ?? []) items.push({ id: r.drive_id, lib: r.library, parent: r.parent_id, name: r.name, mime: r.mime_type, folder: r.is_folder, size: r.size_bytes, modified: r.modified_at });
    if ((data ?? []).length < 1000) break;
  }
  return (
    <DocumentsBrowser
      items={items}
      libraries={Object.entries(LIBRARIES).map(([key, l]) => ({ key: key as keyof typeof LIBRARIES, label: l.label, rootId: l.rootId }))}
      canManage={user.role === "officer"}
      connectedAs={connection?.accountEmail ?? null}
      lastSync={sync?.synced_at ?? null}
      syncError={sync?.error ?? null}
      flag={flag}
    />
  );
}
