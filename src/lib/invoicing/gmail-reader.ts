import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshGoogleAccessToken } from "@/lib/gmail";

/**
 * Reading the data analyst's daily report from Gmail. An officer connects the mailbox the report arrives in once
 * (read-only: the portal can search and read mail there, never send or change anything); the refresh token is kept in
 * self_audit_invoicing_connection (service role only).
 */
export const INVOICING_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
/** Matched as words, so the month in the subject ("- Oct 2026 MTD") can change freely. */
export const REPORT_SUBJECT = "Major Service Indicators Daily Report";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export class InvoicingError extends Error {}

export async function saveInvoicingConnection(input: { refreshToken: string; accountEmail: string; connectedBy: string }) {
  const { error } = await createAdminClient().from("self_audit_invoicing_connection").upsert({
    id: 1,
    refresh_token: input.refreshToken,
    account_email: input.accountEmail,
    connected_by: input.connectedBy,
    connected_at: new Date().toISOString(),
  });
  if (error) throw new InvoicingError(`Could not save the connection: ${error.message}`);
}

export async function getInvoicingConnection(): Promise<{ accountEmail: string } | null> {
  const { data } = await createAdminClient().from("self_audit_invoicing_connection").select("account_email").eq("id", 1).maybeSingle();
  return data ? { accountEmail: data.account_email } : null;
}

async function token(): Promise<string> {
  const { data } = await createAdminClient().from("self_audit_invoicing_connection").select("refresh_token").eq("id", 1).maybeSingle();
  if (!data) throw new InvoicingError("The report mailbox is not connected yet.");
  try {
    return (await refreshGoogleAccessToken(data.refresh_token)).token;
  } catch (e) {
    throw new InvoicingError(
      e instanceof Error && e.message === "invalid_grant" ? "The report mailbox connection has expired - connect it again." : "Could not reach Google - please try again."
    );
  }
}

async function gmail<T>(t: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${t}` }, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new InvoicingError(`Gmail replied ${res.status}: ${json.error?.message ?? "no details"}`);
  return json;
}

type Part = { filename?: string; mimeType?: string; body?: { attachmentId?: string; size?: number }; parts?: Part[] };
type Message = { id: string; internalDate?: string; payload?: Part & { headers?: { name: string; value: string }[] } };

function findSpreadsheet(part: Part | undefined): { filename: string; attachmentId: string } | null {
  if (!part) return null;
  if (part.filename && /\.xlsx$/i.test(part.filename) && part.body?.attachmentId) return { filename: part.filename, attachmentId: part.body.attachmentId };
  for (const p of part.parts ?? []) {
    const hit = findSpreadsheet(p);
    if (hit) return hit;
  }
  return null;
}

export type LatestReport = { messageId: string; subject: string; receivedAt: string; fileName: string; bytes: Buffer };

/**
 * The newest e-mail matching `query` (a Gmail search, e.g. subject words) that has an Excel file attached and whose
 * subject passes `subjectTest`. `skipMessageId`: stop early (no download) when the newest one is the file already imported.
 * Reads the same connected mailbox as the invoicing report.
 */
export async function fetchLatestMailSpreadsheet(query: string, skipMessageId?: string | null, subjectTest?: (subject: string) => boolean): Promise<LatestReport | "unchanged" | null> {
  const t = await token();
  const list = await gmail<{ messages?: { id: string }[] }>(t, `/messages?q=${encodeURIComponent(query)}&maxResults=10`);
  for (const { id } of list.messages ?? []) {
    if (id === skipMessageId) return "unchanged";
    const msg = await gmail<Message>(t, `/messages/${id}?format=full`);
    const subject = msg.payload?.headers?.find((h) => h.name.toLowerCase() === "subject")?.value ?? "";
    if (subjectTest && !subjectTest(subject)) continue;
    const file = findSpreadsheet(msg.payload);
    if (!file) continue;
    const att = await gmail<{ data: string }>(t, `/messages/${id}/attachments/${file.attachmentId}`);
    return {
      messageId: id,
      subject,
      receivedAt: new Date(Number(msg.internalDate ?? Date.now())).toISOString(),
      fileName: file.filename,
      bytes: Buffer.from(att.data, "base64url"),
    };
  }
  return null;
}

/**
 * The newest e-mail whose subject contains the report's name and that has an Excel file attached (searched over the
 * last 40 days). `skipMessageId`: stop early (no download) when the newest one is the report already imported.
 */
export function fetchLatestReport(skipMessageId?: string | null): Promise<LatestReport | "unchanged" | null> {
  return fetchLatestMailSpreadsheet(`subject:("${REPORT_SUBJECT}") has:attachment newer_than:40d`, skipMessageId);
}
