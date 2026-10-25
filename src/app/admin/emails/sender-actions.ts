"use server";

import { requireRole } from "@/lib/auth";
import { getMailStatus, sendMail } from "@/lib/gmail";

/** Sends a short test e-mail to the signed-in officer, so they can see the connected mailbox really delivers. */
export async function sendTestEmail(): Promise<{ error?: string; sentTo?: string; from?: string }> {
  const officer = await requireRole("officer");
  const status = await getMailStatus();
  if (!status) return { error: "Connect the e-mail sender first." };
  const result = await sendMail({
    kind: "test",
    to: [officer.email],
    sentBy: officer.id,
    subject: "Test e-mail from MG Warranty Management",
    text: `Hello ${officer.full_name ?? ""},\n\nThis is a test message. If you can read it, the portal can send e-mail as ${status.accountEmail}.\n\nWarranty Department`.replace("Hello ,", "Hello,"),
    html: `<p>Hello${officer.full_name ? " " + officer.full_name : ""},</p><p>This is a test message. If you can read it, the portal can send e-mail as <strong>${status.accountEmail}</strong>.</p><p>Warranty Department</p>`,
  });
  return result.ok ? { sentTo: officer.email, from: status.accountEmail } : { error: result.error };
}
