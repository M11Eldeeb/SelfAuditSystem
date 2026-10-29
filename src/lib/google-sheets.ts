import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { DRIVE_ALLOWED_DOMAIN, DriveError, driveConfig } from "@/lib/google-drive";

/**
 * Read-only Google Sheets access for the Prior Approvals dashboard tab, over plain OAuth 2.0 + the Sheets REST API.
 * Same pattern as the Drive connection (google-drive.ts): one company Google account is connected once by an officer
 * (it needs to be able to open the sheet), its refresh token is kept in self_audit_google_sheets_connection (service
 * role only) and exchanged for short-lived access tokens. The scope is spreadsheets.readonly - the portal can read
 * sheets, never change them. It reuses the Drive connection's Google OAuth client and its registered redirect address
 * (/api/google-drive/callback), told apart by its own state cookie.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly openid email";
export const SHEETS_STATE_COOKIE = "gs_state";

export function buildSheetsAuthUrl(redirectUri: string, state: string): string {
  const cfg = driveConfig();
  if (!cfg) throw new DriveError("Google sign-in is not configured.");
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SHEETS_SCOPE,
    access_type: "offline",
    prompt: "consent",
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
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) throw new DriveError(json.error_description ?? json.error ?? `Google rejected the request (${res.status}).`, res.status);
  return json as { access_token: string; refresh_token?: string; expires_in?: number };
}

export function exchangeSheetsCode(code: string, redirectUri: string) {
  return tokenRequest({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
}

/** The e-mail of the account behind an access token (used once, at connect time). */
export async function sheetsAccountEmail(accessToken: string): Promise<string> {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as { email?: string };
  if (!res.ok || !json.email) throw new DriveError(`Could not read which Google account connected (${res.status}).`, res.status);
  return json.email.toLowerCase();
}

export type SheetsConnection = { accountEmail: string; connectedAt: string };

/** Who is connected, for the status line. Never exposes the token. */
export async function getSheetsStatus(): Promise<SheetsConnection | null> {
  const { data } = await createAdminClient().from("self_audit_google_sheets_connection").select("account_email, connected_at").eq("id", 1).maybeSingle();
  return data ? { accountEmail: data.account_email, connectedAt: data.connected_at } : null;
}

let cached: { token: string; expiresAt: number } | null = null;

export async function saveSheetsConnection(input: { refreshToken: string; accountEmail: string; connectedBy: string }) {
  const { error } = await createAdminClient().from("self_audit_google_sheets_connection").upsert({
    id: 1,
    refresh_token: input.refreshToken,
    account_email: input.accountEmail,
    connected_by: input.connectedBy,
    connected_at: new Date().toISOString(),
  });
  if (error) throw new DriveError(`Could not save the connection: ${error.message}`);
  cached = null;
}

async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const { data } = await createAdminClient().from("self_audit_google_sheets_connection").select("refresh_token").eq("id", 1).maybeSingle();
  if (!data) throw new DriveError("Google Sheets is not connected yet.");
  try {
    const t = await tokenRequest({ refresh_token: data.refresh_token, grant_type: "refresh_token" });
    cached = { token: t.access_token, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000 };
    return t.access_token;
  } catch (e) {
    cached = null;
    throw new DriveError(
      e instanceof DriveError && e.message === "invalid_grant" ? "The Google Sheets connection has expired - an officer needs to reconnect it." : "Could not reach Google Sheets - please try again.",
      e instanceof DriveError ? e.status : undefined
    );
  }
}

async function sheetsGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken()}` }, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; status?: string } };
  if (!res.ok) {
    const message = json.error?.message ?? "no details from Google";
    if (res.status === 403 && /has not been used|is disabled|SERVICE_DISABLED/i.test(message)) {
      throw new DriveError(
        `The Google Sheets API is switched off for the portal's Google Cloud project. Turn it on (Google Cloud console > APIs & Services > Library > Google Sheets API > Enable), then reload. Google said: ${message}`,
        403
      );
    }
    if (res.status === 403 || res.status === 404) throw new DriveError(`The connected Google account cannot open the sheet (${res.status}): ${message}`, res.status);
    throw new DriveError(`Google Sheets answered ${res.status}: ${message}`, res.status);
  }
  return json;
}

/** Every row of one tab (found by its gid) as raw values: dates come back as serial numbers, numbers as numbers. The first row is the header. */
export async function readSheetTab(spreadsheetId: string, gid: string): Promise<unknown[][]> {
  const meta = await sheetsGet<{ sheets?: { properties: { sheetId: number; title: string } }[] }>(`${SHEETS_API}/${spreadsheetId}?fields=sheets.properties(sheetId,title)`);
  const tab = (meta.sheets ?? []).find((s) => String(s.properties.sheetId) === gid) ?? (meta.sheets ?? [])[0];
  if (!tab) throw new DriveError("The spreadsheet has no tabs.");
  const range = encodeURIComponent(`'${tab.properties.title.replace(/'/g, "''")}'`);
  const values = await sheetsGet<{ values?: unknown[][] }>(
    `${SHEETS_API}/${spreadsheetId}/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER&majorDimension=ROWS`
  );
  return values.values ?? [];
}

/** Every row of one tab found by its name (case-insensitive), as raw values. Null when the spreadsheet has no such tab. */
export async function readSheetNamed(spreadsheetId: string, title: string): Promise<unknown[][] | null> {
  const meta = await sheetsGet<{ sheets?: { properties: { sheetId: number; title: string } }[] }>(`${SHEETS_API}/${spreadsheetId}?fields=sheets.properties(sheetId,title)`);
  const tab = (meta.sheets ?? []).find((s) => s.properties.title.trim().toLowerCase() === title.trim().toLowerCase());
  if (!tab) return null;
  const range = encodeURIComponent(`'${tab.properties.title.replace(/'/g, "''")}'`);
  const values = await sheetsGet<{ values?: unknown[][] }>(
    `${SHEETS_API}/${spreadsheetId}/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER&majorDimension=ROWS`
  );
  return values.values ?? [];
}
