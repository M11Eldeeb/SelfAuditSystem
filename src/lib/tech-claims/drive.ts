import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { DocsError, FOLDER_MIME, LIBRARIES, createDocsFolder, docsFetch } from "@/lib/documents/drive-docs";

/**
 * Technician claims live in Google Drive under Warranty Documents / <Branch> / <WIP> / <claim no.> (claims before
 * 2026-11 under <Branch> / <Technician> / <Work order>), written with the documents' Google account. Folder ids are
 * remembered (self_audit_drive_folders) so the folder tree is looked up once; a folder that was deleted or trashed in
 * Drive is found or made again.
 */
const API = "https://www.googleapis.com/drive/v3";

const folderName = (n: string) => n.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim().slice(0, 120) || "-";
const quote = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function folderUsable(id: string): Promise<boolean> {
  const res = await docsFetch(`${API}/files/${encodeURIComponent(id)}?fields=id,trashed&supportsAllDrives=true`);
  if (!res.ok) return false;
  const json = (await res.json().catch(() => ({}))) as { trashed?: boolean };
  return json.trashed !== true;
}

async function findFolder(parentId: string, name: string): Promise<string | null> {
  const q = encodeURIComponent(`'${parentId}' in parents and name = '${quote(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`);
  const res = await docsFetch(`${API}/files?q=${q}&fields=files(id)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`);
  if (!res.ok) return null;
  const json = (await res.json().catch(() => ({}))) as { files?: { id: string }[] };
  return json.files?.[0]?.id ?? null;
}

/** The folder `name` inside `parentId`: the remembered one (if `key`), else an existing one of that name, else a new one. */
export async function ensureFolder(parentId: string, name: string, key?: string): Promise<string> {
  const admin = createAdminClient();
  if (key) {
    const { data } = await admin.from("self_audit_drive_folders").select("drive_id").eq("key", key).maybeSingle();
    if (data && (await folderUsable(data.drive_id))) return data.drive_id;
  }
  const clean = folderName(name);
  const id = (await findFolder(parentId, clean)) ?? (await createDocsFolder(parentId, clean));
  if (key) await admin.from("self_audit_drive_folders").upsert({ key, drive_id: id });
  return id;
}

/** Warranty Documents / <Branch> / <Technician> - created as needed. Returns the technician's folder. */
export async function ensureTechnicianFolder(input: { branchId: string; branchName: string; technicianId: string; technicianLabel: string }): Promise<string> {
  const branch = await ensureFolder(LIBRARIES.warranty.rootId, input.branchName, `tc:branch:${input.branchId}`);
  return ensureFolder(branch, input.technicianLabel, `tc:tech:${input.branchId}:${input.technicianId}`);
}

/**
 * Warranty Documents / <Branch> / <WIP> - the one folder per WIP that quality control (QC-<WIP>), technician claims,
 * rejected claims and technical inquiries put their own sub-folder in. Created as needed.
 */
export async function ensureWipFolder(input: { branchId: string; branchName: string; wip: string }): Promise<string> {
  const branch = await ensureFolder(LIBRARIES.warranty.rootId, input.branchName, `tc:branch:${input.branchId}`);
  return ensureFolder(branch, input.wip, `wip:${input.branchId}:${input.wip}`);
}

/** Warranty Documents / <Branch> / <WIP> / <sub> (e.g. "QC-HER-12345"). `key` remembers the folder id. */
export async function ensureWipSubFolder(input: { branchId: string; branchName: string; wip: string; sub: string; key: string }): Promise<string> {
  const wip = await ensureWipFolder(input);
  return ensureFolder(wip, input.sub, input.key);
}

/**
 * A technician claim's folder after its work order changed. New claims sit in Warranty Documents / <Branch> / <WIP> /
 * <claim no.> - that folder moves to the new WIP's folder. Older claims (Branch / Technician / <work order>) are renamed.
 */
export async function relocateClaimFolder(input: { folderId: string; claimNo: string; branchId: string; branchName: string; workOrder: string }): Promise<void> {
  const info = await driveFileInfo(input.folderId);
  if (!info) return;
  if (info.name !== input.claimNo) return renameDriveItem(input.folderId, input.workOrder);
  const wip = await ensureWipFolder({ branchId: input.branchId, branchName: input.branchName, wip: input.workOrder });
  if (info.parents[0] && !info.parents.includes(wip)) await moveDriveFile(input.folderId, info.parents[0], wip);
}

export async function renameDriveItem(id: string, name: string): Promise<void> {
  await docsFetch(`${API}/files/${encodeURIComponent(id)}?supportsAllDrives=true`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: folderName(name) }),
  });
}

export type DriveFileInfo = { id: string; name: string; mimeType: string; size: number; parents: string[]; trashed: boolean; thumbnailLink?: string };

export async function driveFileInfo(id: string): Promise<DriveFileInfo | null> {
  const res = await docsFetch(`${API}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,parents,trashed,thumbnailLink&supportsAllDrives=true`);
  if (!res.ok) return null;
  const j = (await res.json().catch(() => null)) as (Omit<DriveFileInfo, "size"> & { size?: string }) | null;
  if (!j?.id) return null;
  return { id: j.id, name: j.name, mimeType: j.mimeType, size: Number(j.size ?? 0), parents: j.parents ?? [], trashed: !!j.trashed, thumbnailLink: j.thumbnailLink };
}

/** Moves a Drive file to the trash (recoverable for 30 days). */
export async function trashDriveFile(id: string): Promise<void> {
  const res = await docsFetch(`${API}/files/${encodeURIComponent(id)}?supportsAllDrives=true`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
  if (!res.ok && res.status !== 404) throw new DocsError("Google Drive did not remove the file - please try again.");
}

export const driveFolderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;
export const driveFileUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;

/**
 * The technician's staging folder (Warranty Documents / <Branch> / <Technician> / _Uploading): files are uploaded here
 * the moment they are added - while the technician still types the VIN and work order - and moved into the work order
 * folder when the claim is submitted.
 */
export async function ensureStagingFolder(input: { branchId: string; branchName: string; technicianId: string; technicianLabel: string }): Promise<string> {
  const branch = await ensureFolder(LIBRARIES.warranty.rootId, input.branchName, `tc:branch:${input.branchId}`);
  const tech = await ensureFolder(branch, input.technicianLabel, `tc:tech:${input.branchId}:${input.technicianId}`);
  return ensureFolder(tech, "_Uploading", `tc:stage:${input.branchId}:${input.technicianId}`);
}

/** The staging folder remembered from earlier (one database lookup, no Drive call) - the fast path for each upload. */
export async function knownStagingFolder(branchId: string, technicianId: string): Promise<string | null> {
  const { data } = await createAdminClient().from("self_audit_drive_folders").select("drive_id").eq("key", `tc:stage:${branchId}:${technicianId}`).maybeSingle();
  return data?.drive_id ?? null;
}

/** Moves a Drive file from one folder to another (instant - nothing is copied); `newName` renames it in the same call. */
export async function moveDriveFile(id: string, from: string, to: string, newName?: string): Promise<void> {
  const res = await docsFetch(`${API}/files/${encodeURIComponent(id)}?addParents=${encodeURIComponent(to)}&removeParents=${encodeURIComponent(from)}&supportsAllDrives=true&fields=id`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(newName ? { name: newName } : {}),
  });
  if (!res.ok) throw new DocsError("Google Drive did not move a file - please try again.");
}

/** Renames a file in Drive (the name is used as given - unlike renameDriveItem, which cleans a folder name). */
export async function renameDriveFile(id: string, name: string): Promise<void> {
  const res = await docsFetch(`${API}/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok && res.status !== 404) throw new DocsError("Google Drive did not rename a file - please try again.");
}

/** Staged files nobody submitted within two days (the claim was abandoned) go to the Drive trash. */
export async function cleanStagingFolder(folderId: string): Promise<void> {
  const cutoff = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false and modifiedTime < '${cutoff}'`);
  const res = await docsFetch(`${API}/files?q=${q}&fields=files(id)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`);
  if (!res.ok) return;
  const json = (await res.json().catch(() => ({}))) as { files?: { id: string }[] };
  await Promise.all((json.files ?? []).map((f) => trashDriveFile(f.id).catch(() => undefined)));
}
