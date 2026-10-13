import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { DRIVE_ALLOWED_DOMAIN, driveConfig } from "@/lib/google-drive";

/**
 * Sending e-mail through Gmail, as a company mailbox. An officer connects the
 * mailbox once (plain OAuth 2.0, the same Google client the Drive connection
 * uses); its refresh token is kept in self_audit_email_connection (service role
 * only). The scope is gmail.send: the site can send mail as that mailbox and
 * nothing else - it cannot read anything in it. Every attempt is written to
 * self_audit_email_log.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export const MAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";
/** Shown as the sender's name; the address is the connected mailbox. */
export const MAIL_FROM_NAME = "Warranty Department - Jiad Motors";

export class MailError extends Error {}

export function buildMailAuthUrl(redirectUri: string, state: string): string {
  const cfg = driveConfig();
  if (!cfg) throw new MailError("Google sign-in is not configured.");
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: `openid email ${MAIL_SCOPE}`, // openid + email only to learn which mailbox signed in
    access_type: "offline",
    prompt: "consent",
    hd: DRIVE_ALLOWED_DOMAIN,
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string; error?: string; error_description?: string };

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse & { access_token: string }> {
  const cfg = driveConfig();
  if (!cfg) throw new MailError("Google sign-in is not configured.");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...body }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !json.access_token) throw new MailError(json.error_description ?? json.error ?? `Google rejected the request (${res.status}).`);
  return json as TokenResponse & { access_token: string };
}

/** Trades the sign-in code for the mailbox's address and a lasting refresh token. */
export async function exchangeMailCode(code: string, redirectUri: string): Promise<{ refreshToken: string | null; email: string; canSend: boolean }> {
  const t = await tokenRequest({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
  // The id_token came straight from Google's token endpoint over TLS, so its payload can be read without checking a signature.
  let email = "";
  try {
    const payload = JSON.parse(Buffer.from((t.id_token ?? "").split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: string; email_verified?: boolean };
    if (payload.email_verified !== false) email = (payload.email ?? "").toLowerCase();
  } catch {
    // email stays empty and the caller reports it
  }
  return { refreshToken: t.refresh_token ?? null, email, canSend: (t.scope ?? "").split(" ").includes(MAIL_SCOPE) };
}

export type MailConnection = { accountEmail: string; connectedAt: string };

export async function getMailStatus(): Promise<MailConnection | null> {
  const { data } = await createAdminClient().from("self_audit_email_connection").select("account_email, connected_at").eq("id", 1).maybeSingle();
  return data ? { accountEmail: data.account_email, connectedAt: data.connected_at } : null;
}

export async function saveMailConnection(input: { refreshToken: string; accountEmail: string; connectedBy: string }) {
  const { error } = await createAdminClient().from("self_audit_email_connection").upsert({
    id: 1,
    refresh_token: input.refreshToken,
    account_email: input.accountEmail,
    connected_by: input.connectedBy,
    connected_at: new Date().toISOString(),
  });
  if (error) throw new MailError(`Could not save the connection: ${error.message}`);
  cached = null;
}

let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<{ token: string; from: string }> {
  const { data } = await createAdminClient().from("self_audit_email_connection").select("refresh_token, account_email").eq("id", 1).maybeSingle();
  if (!data) throw new MailError("The e-mail sender is not connected yet.");
  if (cached && cached.expiresAt > Date.now() + 60_000) return { token: cached.token, from: data.account_email };
  try {
    const t = await tokenRequest({ refresh_token: data.refresh_token, grant_type: "refresh_token" });
    cached = { token: t.access_token, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000 };
    return { token: t.access_token, from: data.account_email };
  } catch (e) {
    cached = null;
    throw new MailError(
      e instanceof MailError && e.message === "invalid_grant"
        ? "The e-mail connection has expired - an officer needs to reconnect it."
        : "Could not reach Google - please try again."
    );
  }
}

// ---- building the message ---------------------------------------------------------------

const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
/** RFC 2047 encoded-word so a subject (or a name) with any characters, Arabic included, survives. */
const encodeWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
const wrap76 = (b64: string) => b64.replace(/(.{76})/g, "$1\r\n");

function buildMime(input: { from: string; to: string[]; bcc: string[]; subject: string; text: string; html?: string; replyTo?: string }): string {
  const boundary = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const lines = [
    `From: ${encodeWord(MAIL_FROM_NAME)} <${input.from}>`,
    input.to.length ? `To: ${input.to.join(", ")}` : null,
    input.bcc.length ? `Bcc: ${input.bcc.join(", ")}` : null,
    input.replyTo ? `Reply-To: ${input.replyTo}` : null,
    `Subject: ${encodeWord(oneLine(input.subject))}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter((l): l is string => l !== null);

  const part = (type: string, body: string) =>
    `--${boundary}\r\nContent-Type: ${type}; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(Buffer.from(body, "utf8").toString("base64"))}\r\n`;
  return `${lines.join("\r\n")}\r\n\r\n${part("text/plain", input.text)}${input.html ? part("text/html", input.html) : ""}--${boundary}--`;
}

export type SendMailInput = {
  kind: string; // e.g. "test", "cycle-reminder" - what the log files it under
  to?: string[];
  bcc?: string[]; // for a mail to many branches at once: nobody sees the others
  subject: string;
  text: string;
  html?: string;
  sentBy?: string | null;
};

/** Sends one e-mail and logs the attempt. Never throws: the result says what happened. */
export async function sendMail(input: SendMailInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const clean = (list: string[] | undefined) => [...new Set((list ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const to = clean(input.to);
  const bcc = clean(input.bcc);
  const recipients = [...to, ...bcc];
  const log = async (status: "sent" | "failed", extra: { error?: string; id?: string }) => {
    await createAdminClient()
      .from("self_audit_email_log")
      .insert({ kind: input.kind, recipients, subject: oneLine(input.subject), status, error: extra.error ?? null, gmail_message_id: extra.id ?? null, sent_by: input.sentBy ?? null });
  };

  try {
    if (recipients.length === 0) throw new MailError("There is nobody to send this to.");
    const bad = recipients.find((e) => !EMAIL.test(e));
    if (bad) throw new MailError(`"${bad}" is not a valid e-mail address.`);

    const { token, from } = await accessToken();
    const raw = Buffer.from(buildMime({ from, to: to.length ? to : [from], bcc, subject: input.subject, text: input.text, html: input.html })).toString("base64url");
    const res = await fetch(SEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    if (!res.ok || !json.id) throw new MailError(`Gmail refused the message (${res.status}): ${json.error?.message ?? "no details"}`);
    await log("sent", { id: json.id });
    return { ok: true, id: json.id };
  } catch (e) {
    const error = e instanceof Error ? e.message : "The e-mail could not be sent.";
    console.error(`E-mail "${input.kind}" failed:`, error);
    await log("failed", { error }).catch(() => undefined);
    return { ok: false, error };
  }
}
