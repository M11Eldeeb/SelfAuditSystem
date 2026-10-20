import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshGoogleAccessToken } from "@/lib/gmail";

/**
 * Warranty and Technical Documents: two Google Drive folders, shown in the portal. Drive stays the place the files
 * live; the portal reads (and uploads into) them with one Google account an officer connects once, and keeps an
 * index of both folder trees (self_audit_docs_index) so browsing and searching are instant.
 */
export const DOCS_SCOPE = "https://www.googleapis.com/auth/drive";
export const LIBRARIES = {
  warranty: { label: "Warranty Documents", rootId: "1BiAjhlaL8aP0_1HwuzR8EcdQiW5uEy_W" },
  technical: { label: "Technical Documents", rootId: "1ys98L4sR5AyVPkSnNfawLvRzxXhpB9mf" },
} as const;
export type Library = keyof typeof LIBRARIES;

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
export const FOLDER_MIME = "application/vnd.google-apps.folder";

export class DocsError extends Error {}

export async function saveDocsConnection(input: { refreshToken: string; accountEmail: string; connectedBy: string }) {
  const { error } = await createAdminClient()
    .from("self_audit_docs_connection")
    .upsert({ id: 1, refresh_token: input.refreshToken, account_email: input.accountEmail, connected_by: input.connectedBy, connected_at: new Date().toISOString() });
  if (error) throw new DocsError(`Could not save the connection: ${error.message}`);
  cached = null;
}

export async function getDocsConnection(): Promise<{ accountEmail: string } | null> {
  const { data } = await createAdminClient().from("self_audit_docs_connection").select("account_email").eq("id", 1).maybeSingle();
  return data ? { accountEmail: data.account_email } : null;
}

let cached: { token: string; expiresAt: number } | null = null;
async function token(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const { data } = await createAdminClient().from("self_audit_docs_connection").select("refresh_token").eq("id", 1).maybeSingle();
  if (!data) throw new DocsError("The documents' Google account is not connected yet.");
  try {
    const t = await refreshGoogleAccessToken(data.refresh_token);
    cached = { token: t.token, expiresAt: Date.now() + t.expiresIn * 1000 };
    return t.token;
  } catch (e) {
    throw new DocsError(e instanceof Error && e.message === "invalid_grant" ? "The documents' Google connection has expired - connect it again." : "Could not reach Google - please try again.");
  }
}

export async function docsFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const t = await token();
  return fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}` }, cache: "no-store" });
}

type DriveItem = { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string; shortcutDetails?: { targetId: string; targetMimeType: string } };

async function listChildren(folderId: string): Promise<DriveItem[]> {
  const out: DriveItem[] = [];
  let pageToken = "";
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const res = await docsFetch(
      `${API}/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,size,modifiedTime,shortcutDetails)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${pageToken}` : ""}`
    );
    const json = (await res.json().catch(() => ({}))) as { files?: DriveItem[]; nextPageToken?: string; error?: { message?: string } };
    if (!res.ok) throw new DocsError(`Google Drive replied ${res.status}: ${json.error?.message ?? "no details"}`);
    out.push(...(json.files ?? []));
    pageToken = json.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

/**
 * Walks both folder trees (breadth first, a few folders at a time) and replaces the index. Shortcuts are listed as
 * the file they point to. Returns how many files and folders were found.
 */
export async function syncDocsIndex(): Promise<{ files: number }> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const rows: {
    drive_id: string;
    library: Library;
    parent_id: string | null;
    name: string;
    mime_type: string;
    is_folder: boolean;
    size_bytes: number | null;
    modified_at: string | null;
    path: string;
    synced_at: string;
  }[] = [];
  try {
    for (const [library, { label, rootId }] of Object.entries(LIBRARIES) as [Library, (typeof LIBRARIES)[Library]][]) {
      let queue: { id: string; path: string }[] = [{ id: rootId, path: label }];
      const seen = new Set<string>([rootId]);
      while (queue.length) {
        const batch = queue.splice(0, 8);
        const lists = await Promise.all(batch.map((f) => listChildren(f.id)));
        batch.forEach((folder, i) => {
          for (const item of lists[i]) {
            const id = item.shortcutDetails?.targetId ?? item.id;
            const mime = item.shortcutDetails?.targetMimeType ?? item.mimeType;
            if (seen.has(id)) continue;
            seen.add(id);
            const isFolder = mime === FOLDER_MIME;
            rows.push({
              drive_id: id,
              library,
              parent_id: folder.id,
              name: item.name.slice(0, 300),
              mime_type: mime,
              is_folder: isFolder,
              size_bytes: item.size ? Number(item.size) : null,
              modified_at: item.modifiedTime ?? null,
              path: folder.path,
              synced_at: now,
            });
            if (isFolder) queue.push({ id, path: `${folder.path} / ${item.name}` });
          }
        });
        if (rows.length > 20000) {
          queue = [];
          break;
        }
      }
    }
    for (let i = 0; i < rows.length; i += 1000) {
      const { error } = await admin.from("self_audit_docs_index").upsert(rows.slice(i, i + 1000));
      if (error) throw new DocsError(error.message);
    }
    // Anything not seen in this walk was deleted or moved out of the two folders.
    await admin.from("self_audit_docs_index").delete().lt("synced_at", now);
    await admin.from("self_audit_docs_sync").upsert({ id: 1, synced_at: now, files: rows.length, error: null });
    return { files: rows.length };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed.";
    await admin.from("self_audit_docs_sync").upsert({ id: 1, error: message.slice(0, 300) });
    throw e instanceof DocsError ? e : new DocsError(message);
  }
}

/** Google Docs / Sheets / Slides have no bytes of their own: they are exported (as PDF) to be viewed in the portal. */
export function exportMimeFor(mime: string): string | null {
  return mime.startsWith("application/vnd.google-apps.") && mime !== FOLDER_MIME ? "application/pdf" : null;
}

export async function downloadDoc(fileId: string, mime: string, range?: string | null): Promise<Response> {
  const exportAs = exportMimeFor(mime);
  if (exportAs) return docsFetch(`${API}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportAs)}`);
  return docsFetch(`${API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, { headers: range ? { Range: range } : undefined });
}

/** A resumable upload session into a folder of the libraries; the browser sends the bytes straight to Google. */
export async function startDocsUpload(input: { parentId: string; name: string; mimeType: string; size: number; origin: string }): Promise<string> {
  const res = await docsFetch(`${UPLOAD_API}/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,size,modifiedTime`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": input.mimeType,
      "X-Upload-Content-Length": String(input.size),
      Origin: input.origin,
    },
    body: JSON.stringify({ name: input.name, parents: [input.parentId] }),
  });
  const location = res.headers.get("Location");
  if (!res.ok || !location) throw new DocsError("Google Drive refused the upload - please try again.");
  return location;
}

export async function createDocsFolder(parentId: string, name: string): Promise<string> {
  const res = await docsFetch(`${API}/files?supportsAllDrives=true&fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!res.ok || !json.id) throw new DocsError(json.error?.message ?? "Could not create the folder.");
  return json.id;
}
