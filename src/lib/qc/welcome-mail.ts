import "server-only";
import { sendMail, type SendMailResult } from "@/lib/gmail";
import { QC_WELCOME_SUBJECT, qcWelcomeHtml, qcWelcomeText, type QcWelcome } from "./welcome-html";

/** The e-mail log kind of the quality controller's welcome e-mail (each account gets it once). */
export const QC_WELCOME_KIND = "qc-welcome";

/** Sends the welcome e-mail (sign-in with the temporary password and the QC guide) to a new quality controller. */
export async function sendQcWelcome(o: QcWelcome & { sentBy?: string | null }): Promise<SendMailResult> {
  return sendMail({
    kind: QC_WELCOME_KIND,
    to: [o.email],
    subject: QC_WELCOME_SUBJECT,
    text: qcWelcomeText(o),
    html: qcWelcomeHtml(o),
    sentBy: o.sentBy ?? null,
  });
}
