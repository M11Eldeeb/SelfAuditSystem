"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { getMailStatus, sendMail } from "@/lib/gmail";

const NOT_CONNECTED = "The e-mail sender is not connected yet - connect it in Settings → Email settings first.";

/**
 * Sends a ready-made e-mail straight from the connected company mailbox
 * (instead of opening the officer's mail app). Optional attachment comes from
 * the browser as base64 (e.g. the sample Excel, the podium image).
 */
export async function sendDirectMail(input: {
  kind: string;
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  attachment?: { filename: string; mimeType: string; base64: string };
}): Promise<{ error?: string; to?: string[] }> {
  const officer = await requireRole("officer");
  if (!(await getMailStatus())) return { error: NOT_CONNECTED };
  const res = await sendMail({
    kind: input.kind.slice(0, 40),
    to: input.to,
    cc: input.cc,
    subject: input.subject,
    text: input.text,
    sentBy: officer.id,
    attachments: input.attachment
      ? [{ filename: input.attachment.filename, mimeType: input.attachment.mimeType, data: Buffer.from(input.attachment.base64, "base64") }]
      : undefined,
  });
  if (!res.ok) return { error: res.error };
  revalidatePath("/admin/emails");
  return { to: input.to };
}
