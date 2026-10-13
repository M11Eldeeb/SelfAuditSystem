import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Google Drive for the Rejected Claims Diary, over plain OAuth 2.0 + the Drive
 * REST API (no SDK). One company Google account is connected once by an
 * officer; its refresh token is kept in self_audit_google_drive_connection
 * (service role only) and used to get short-lived access tokens.
 *
 * The scope is drive.file: the app only ever sees folders and files it created
 * itself. Folder ids are therefore kept in self_audit_drive_folders instead of
 * being looked up by name.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
/** Only an account on this Google Workspace domain may be connected. */
export const DRIVE_ALLOWED_DOMAIN = "jiadmotors.com";
export const DRIVE_ROOT_FOLDER_NAME = "Rejected Claims From Workshop";

export class DriveError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message);
  }
}

export function driveConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function buildAuthUrl(redirectUri: string, state: string): string {
  const cfg = driveConfig();
  if (!cfg) throw new DriveError("Google sign-in is not configured.");
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: DRIVE_SCOPE,
    access_type: "offline", // a refresh token, so the connection outlives one session
    prompt: "consent", // always issue a refresh token, even when reconnecting
    hd: DRIVE_ALLOWED_DOMAIN,
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function tokenRequest(body: Record<string, string>) {
  const cfg = driveConfig();
  if (!cfg) throw new DriveError("Google sign-in is not configured.");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...body }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new DriveError(json.error_description ?? json.error ?? `Google rejected the request (${res.status}).`, res.status);
  }
  return json as Required<Pick<typeof json, "access_token">> & typeof json;
}

export function exchangeCode(code: string, redirectUri: string) {
  return tokenRequest({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
}

// ---- stored connection --------------------------------------------------------------

export type DriveConnection = { accountEmail: string; rootFolderId: string; connectedAt: string };

/** Who is connected, for the officer's status line. Never exposes the token. */
export async function getDriveStatus(): Promise<DriveConnection | null> {
  const { data } = await createAdminClient()
    .from("self_audit_google_drive_connection")
    .select("account_email, root_folder_id, connected_at")
    .eq("id", 1)
    .maybeSingle();
  return data ? { accountEmail: data.account_email, rootFolderId: data.root_folder_id, connectedAt: data.connected_at } : null;
}

export async function saveDriveConnection(input: {
  refreshToken: string;
  accountEmail: string;
  rootFolderId: string;
  connectedBy: string;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("self_audit_google_drive_connection").upsert({
    id: 1,
    refresh_token: input.refreshToken,
    account_email: input.accountEmail,
    root_folder_id: input.rootFolderId,
    connected_by: input.connectedBy,
    connected_at: new Date().toISOString(),
  });
  if (error) throw new DriveError(`Could not save the connection: ${error.message}`);
  // A different account has different folders: forget the old ids.
  await admin.from("self_audit_drive_folders").delete().neq("key", "");
}

// ---- access token ---------------------------------------------------------------------

let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const { data } = await createAdminClient().from("self_audit_google_drive_connection").select("refresh_token").eq("id", 1).maybeSingle();
  if (!data) throw new DriveError("Google Drive is not connected yet.");
  try {
    const t = await tokenRequest({ refresh_token: data.refresh_token, grant_type: "refresh_token" });
    cached = { token: t.access_token, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000 };
    return t.access_token;
  } catch (e) {
    cached = null;
    throw new DriveError(
      e instanceof DriveError && e.message === "invalid_grant"
        ? "The Google Drive connection has expired - an officer needs to reconnect it."
        : "Could not reach Google Drive - please try again.",
      e instanceof DriveError ? e.status : undefined
    );
  }
}

async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  return fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` }, cache: "no-store" });
}

// ---- account, folders, files ----------------------------------------------------------

/** The e-mail of the account behind an access token (used once, at connect time). */
export async function accountEmailFor(accessTokenValue: string): Promise<string> {
  const res = await fetch(`${API}/about?fields=user(emailAddress)`, {
    headers: { Authorization: `Bearer ${accessTokenValue}` },
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { user?: { emailAddress?: string }; error?: { message?: string } };
  const email = json.user?.emailAddress;
  if (!res.ok || !email) {
    throw new DriveError(`Could not read which Google account was connected (${res.status}): ${json.error?.message ?? "no details from Google"}`, res.status);
  }
  return email.toLowerCase();
}

export async function createFolderWithToken(accessTokenValue: string, name: string, parentId?: string): Promise<string> {
  const res = await fetch(`${API}/files?fields=id&supportsAllDrives=true`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessTokenValue}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", ...(parentId ? { parents: [parentId] } : {}) }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!res.ok || !json.id) {
    throw new DriveError(`Could not create the "${name}" folder in Drive (${res.status}): ${json.error?.message ?? "no details from Google"}`, res.status);
  }
  return json.id;
}

async function folderUsable(id: string): Promise<boolean> {
  const res = await driveFetch(`${API}/files/${encodeURIComponent(id)}?fields=id,trashed&supportsAllDrives=true`);
  if (!res.ok) return false;
  const json = (await res.json().catch(() => ({}))) as { trashed?: boolean };
  return json.trashed !== true;
}

/**
 * The Drive folder for `key` (e.g. "branch:<id>"), creating it under `parentId`
 * on first use. If someone deleted or trashed it in Drive, a fresh one is made.
 */
export async function ensureFolder(key: string, name: string, parentId: string): Promise<string> {
  const admin = createAdminClient();
  const { data: known } = await admin.from("self_audit_drive_folders").select("drive_id").eq("key", key).maybeSingle();
  if (known && (await folderUsable(known.drive_id))) return known.drive_id;

  const token = await accessToken();
  const id = await createFolderWithToken(token, name, parentId);
  await admin.from("self_audit_drive_folders").upsert({ key, drive_id: id });
  return id;
}

/**
 * Opens a resumable upload session and returns its URL. The browser then PUTs
 * the file straight to Google (a serverless request body is capped far below
 * 20 MB). `origin` must be the page's origin so Google answers the browser's
 * cross-origin upload.
 */
export async function startResumableUpload(input: {
  parentId: string;
  name: string;
  mimeType: string;
  size: number;
  origin: string;
}): Promise<string> {
  const res = await driveFetch(`${UPLOAD_API}/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,size`, {
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
  if (!res.ok || !location) throw new DriveError("Google Drive refused the upload - please try again.", res.status);
  return location;
}

export type DriveFileMeta = { id: string; name: string; size: number; mimeType: string; parents: string[]; trashed: boolean; webViewLink: string | null };

export async function getFileMeta(fileId: string): Promise<DriveFileMeta | null> {
  const res = await driveFetch(
    `${API}/files/${encodeURIComponent(fileId)}?fields=id,name,size,mimeType,parents,trashed,webViewLink&supportsAllDrives=true`
  );
  if (!res.ok) return null;
  const j = (await res.json().catch(() => null)) as {
    id: string;
    name: string;
    size?: string;
    mimeType: string;
    parents?: string[];
    trashed?: boolean;
    webViewLink?: string;
  } | null;
  if (!j) return null;
  return {
    id: j.id,
    name: j.name,
    size: Number(j.size ?? 0),
    mimeType: j.mimeType,
    parents: j.parents ?? [],
    trashed: j.trashed === true,
    webViewLink: j.webViewLink ?? null,
  };
}

export type ShareResult = { shared: string[]; already: string[]; failed: { email: string; reason: string }[] };

/**
 * Gives each e-mail view access to a folder (and so everything inside it). Skips
 * people who already have access, so it is safe to run again whenever a new
 * officer joins. Google e-mails each newly shared person once.
 */
export async function shareFolderWithEmails(folderId: string, emails: string[]): Promise<ShareResult> {
  const result: ShareResult = { shared: [], already: [], failed: [] };
  const listRes = await driveFetch(`${API}/files/${encodeURIComponent(folderId)}/permissions?fields=permissions(emailAddress)&supportsAllDrives=true`);
  const listed = listRes.ok ? ((await listRes.json().catch(() => ({}))) as { permissions?: { emailAddress?: string }[] }) : {};
  const existing = new Set((listed.permissions ?? []).flatMap((p) => (p.emailAddress ? [p.emailAddress.toLowerCase()] : [])));

  for (const email of emails) {
    if (existing.has(email)) {
      result.already.push(email);
      continue;
    }
    const res = await driveFetch(`${API}/files/${encodeURIComponent(folderId)}/permissions?supportsAllDrives=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "user", role: "reader", emailAddress: email }),
    });
    if (res.ok) {
      result.shared.push(email);
    } else {
      const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      result.failed.push({ email, reason: j.error?.message ?? `Google replied ${res.status}` });
    }
  }
  return result;
}

/** Shares the diary's Drive folder with every officer's company e-mail (view only). */
export async function shareRootWithOfficers(): Promise<ShareResult | null> {
  const drive = await getDriveStatus();
  if (!drive) return null;
  const { data: officers } = await createAdminClient().from("self_audit_users").select("email").eq("role", "officer");
  const emails = [
    ...new Set(
      (officers ?? [])
        .map((o) => o.email?.trim().toLowerCase())
        .filter((e): e is string => !!e && e.endsWith(`@${DRIVE_ALLOWED_DOMAIN}`) && e !== drive.accountEmail.toLowerCase())
    ),
  ];
  return shareFolderWithEmails(drive.rootFolderId, emails);
}

/** Creates a small file (the logbook PDF) from bytes the server already has. Returns its id. */
export async function createFileWithBytes(input: { parentId: string; name: string; mimeType: string; bytes: Uint8Array }): Promise<string> {
  const boundary = `logbook${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const metadata = JSON.stringify({ name: input.name, parents: [input.parentId] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${input.mimeType}\r\n\r\n`),
    Buffer.from(input.bytes),
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await driveFetch(`${UPLOAD_API}/files?uploadType=multipart&supportsAllDrives=true&fields=id`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!res.ok || !json.id) throw new DriveError(`Could not save "${input.name}" to Drive (${res.status}): ${json.error?.message ?? "no details"}`, res.status);
  return json.id;
}

/** Replaces a file's content in place (same link, Drive keeps the earlier version in its history). False if the file is gone. */
export async function replaceFileBytes(fileId: string, mimeType: string, bytes: Uint8Array): Promise<boolean> {
  const res = await driveFetch(`${UPLOAD_API}/files/${encodeURIComponent(fileId)}?uploadType=media&supportsAllDrives=true&fields=id,trashed`, {
    method: "PATCH",
    headers: { "Content-Type": mimeType },
    body: Buffer.from(bytes),
  });
  if (res.status === 404) return false;
  const json = (await res.json().catch(() => ({}))) as { trashed?: boolean; error?: { message?: string } };
  if (!res.ok) throw new DriveError(`Could not update the file in Drive (${res.status}): ${json.error?.message ?? "no details"}`, res.status);
  return json.trashed !== true;
}

/** The file's bytes (honouring a Range header so videos can seek). */
export async function downloadFile(fileId: string, range?: string | null): Promise<Response> {
  return driveFetch(`${API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {
    headers: range ? { Range: range } : undefined,
  });
}
