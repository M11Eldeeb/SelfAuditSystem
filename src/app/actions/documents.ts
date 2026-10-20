"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getCurrentUser, requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { DocsError, FOLDER_MIME, LIBRARIES, createDocsFolder, getDocsConnection, startDocsUpload, syncDocsIndex, type Library } from "@/lib/documents/drive-docs";

const DOC_PATHS = ["/admin/documents", "/audit/documents", "/workshop/documents", "/technical/documents"];
const revalidateAll = () => DOC_PATHS.forEach((p) => revalidatePath(p));
/** Anyone may trigger a re-read of the folders, but not more often than this. */
const MIN_SYNC_GAP_MS = 10 * 60_000;

/** Re-reads both Drive folders into the index. Officers any time; others only when the index is older than 10 minutes. */
export async function syncDocuments(): Promise<{ error?: string; files?: number; skipped?: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in." };
  if (!(await getDocsConnection())) return { error: "The documents' Google account is not connected yet." };
  if (user.role !== "officer") {
    const { data } = await createAdminClient().from("self_audit_docs_sync").select("synced_at").eq("id", 1).maybeSingle();
    if (data?.synced_at && Date.now() - Date.parse(data.synced_at) < MIN_SYNC_GAP_MS) return { skipped: true };
  }
  try {
    const r = await syncDocsIndex();
    revalidateAll();
    return { files: r.files };
  } catch (e) {
    return { error: e instanceof DocsError ? e.message : "Could not read Google Drive." };
  }
}

/** The folder must be one of the two libraries or a folder inside them. */
async function folderInfo(folderId: string): Promise<{ library: Library; path: string } | null> {
  for (const [library, { rootId, label }] of Object.entries(LIBRARIES) as [Library, (typeof LIBRARIES)[Library]][]) if (folderId === rootId) return { library, path: label };
  const { data } = await createAdminClient().from("self_audit_docs_index").select("library, path, name, is_folder").eq("drive_id", folderId).maybeSingle();
  return data?.is_folder ? { library: data.library, path: `${data.path} / ${data.name}` } : null;
}

const safeName = (n: string) => n.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim().slice(0, 200) || "file";

/** Officers: open one Google upload session per file into a library folder (the browser then sends the bytes). */
export async function prepareDocumentUploads(folderId: string, files: { name: string; type: string; size: number }[]): Promise<{ sessions?: string[]; error?: string }> {
  await requireRole("officer");
  if (!files.length || files.length > 30) return { error: "Choose 1 to 30 files." };
  if (files.some((f) => !(f.size > 0) || f.size > 500 * 1024 * 1024)) return { error: "Each file must be under 500 MB." };
  if (!(await folderInfo(folderId))) return { error: "Folder not found." };
  const origin = (await headers()).get("origin");
  if (!origin) return { error: "Please reload the page and try again." };
  try {
    const sessions = await Promise.all(files.map((f) => startDocsUpload({ parentId: folderId, name: safeName(f.name), mimeType: f.type || "application/octet-stream", size: f.size, origin })));
    return { sessions };
  } catch (e) {
    return { error: e instanceof DocsError ? e.message : "Could not reach Google Drive." };
  }
}

/** Officers: adds the files just uploaded to the index (so they show at once, without a full re-read). */
export async function registerDocumentUploads(folderId: string, items: { id: string; name: string; mimeType: string; size?: string | number; modifiedTime?: string }[]): Promise<{ error?: string }> {
  await requireRole("officer");
  const info = await folderInfo(folderId);
  if (!info) return { error: "Folder not found." };
  const { error } = await createAdminClient()
    .from("self_audit_docs_index")
    .upsert(
      items.slice(0, 30).map((i) => ({
        drive_id: i.id,
        library: info.library,
        parent_id: folderId,
        name: i.name.slice(0, 300),
        mime_type: i.mimeType,
        is_folder: false,
        size_bytes: i.size != null ? Number(i.size) : null,
        modified_at: i.modifiedTime ?? new Date().toISOString(),
        path: info.path,
        synced_at: new Date().toISOString(),
      }))
    );
  if (error) return { error: error.message };
  revalidateAll();
  return {};
}

/** Officers: a new folder inside a library folder (created in Google Drive). */
export async function createDocumentFolder(parentId: string, name: string): Promise<{ error?: string }> {
  await requireRole("officer");
  const clean = safeName(name);
  if (!name.trim()) return { error: "Enter the folder name." };
  const info = await folderInfo(parentId);
  if (!info) return { error: "Folder not found." };
  try {
    const id = await createDocsFolder(parentId, clean);
    await createAdminClient().from("self_audit_docs_index").upsert({
      drive_id: id,
      library: info.library,
      parent_id: parentId,
      name: clean,
      mime_type: FOLDER_MIME,
      is_folder: true,
      path: info.path,
      modified_at: new Date().toISOString(),
      synced_at: new Date().toISOString(),
    });
    revalidateAll();
    return {};
  } catch (e) {
    return { error: e instanceof DocsError ? e.message : "Could not create the folder." };
  }
}
