import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { sendMail, type MailAttachment, type SendMailResult } from "@/lib/gmail";

/**
 * The welcome e-mail for a new service advisor or reception account: the sign-in (with the temporary password) and a
 * six-step guide to Courtesy Cars, each step with its screen (pictures inside the mail, from public/courtesy/guide;
 * customer details in them are blurred and the PDF shows sample data).
 */

const RED = "#c4121a";
const GUIDE: { file: string; width: number; height: number; alt: string }[] = [
  { file: "form-en.jpg", width: 220, height: 450, alt: "Customer form in English" },
  { file: "form-ar2.jpg", width: 220, height: 450, alt: "Customer form in Arabic" },
  { file: "agreements.jpg", width: 560, height: 349, alt: "Agreements tab" },
  { file: "damage.jpg", width: 560, height: 349, alt: "Damage marks on the car drawing" },
  { file: "pdf-gatepass.jpg", width: 560, height: 396, alt: "Filled Vehicle Gate Pass" },
  { file: "detail.jpg", width: 560, height: 349, alt: "Agreement after the return" },
  { file: "dashview.jpg", width: 560, height: 349, alt: "Courtesy Cars dashboard" },
];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const cidOf = (file: string) => `guide-${file.replace(/\W/g, "-")}@mg-warranty`;

function pic(file: string) {
  const g = GUIDE.find((x) => x.file === file)!;
  return `<img src="cid:${cidOf(file)}" width="${g.width}" height="${g.height}" alt="${g.alt}" style="display:block;border:1px solid #e4e0da;border-radius:10px;max-width:100%;height:auto">`;
}

function step(num: number, title: string, body: string, image: string) {
  return `<tr><td style="padding:18px 0 6px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:top;padding-right:12px"><div style="width:30px;height:30px;border-radius:15px;background:${RED};color:#fff;font-weight:700;text-align:center;line-height:30px">${num}</div></td>
<td style="vertical-align:top"><div style="font-size:16px;font-weight:700;color:#1c1f24">${title}</div><div style="color:#4a5260;margin-top:2px">${body}</div></td></tr></table></td></tr>
<tr><td style="padding:6px 0 4px 42px">${image}</td></tr>`;
}

export function welcomeHtml(o: { name: string; email: string; tempPassword: string; receptionManager: boolean; senderName: string; site: string }) {
  const first = esc(o.name.trim().split(/\s+/)[0] || "colleague");
  const phones = `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:12px">${pic("form-en.jpg")}</td><td>${pic("form-ar2.jpg")}</td></tr></table>`;
  return `<div style="background:#f3f1ee;padding:24px 0;font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1c1f24">
<table role="presentation" width="640" align="center" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;margin:0 auto">
<tr><td style="background:#16191d;border-radius:14px 14px 0 0;padding:22px 28px">
<div style="color:${RED};font-weight:800;letter-spacing:2px;font-size:13px">MG WARRANTY PORTAL</div>
<div style="color:#f3f1ee;font-size:24px;font-weight:800;margin-top:4px">Courtesy Cars &ndash; Version 2</div>
<div style="color:#c9cdd3;font-size:14px">Your account is ready</div></td></tr>
<tr><td style="padding:24px 28px 8px">
<p style="margin:0 0 12px">Dear ${first},</p>
<p style="margin:0 0 12px">Your account for the <b>MG Warranty portal</b> is ready. From today all courtesy car agreements are made in the portal.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f5f2;border-left:4px solid ${RED};margin:6px 0 14px"><tr><td style="padding:12px 16px">
<b>Your sign-in</b><br>Link: <a href="${o.site}" style="color:${RED}">${o.site}</a><br>
E-mail: ${esc(o.email)}<br>Temporary password: <b style="font-family:Consolas,monospace">${esc(o.tempPassword)}</b><br>
<span style="color:#4a5260;font-size:13px">You choose your own password the first time you sign in. Please do not share it.</span></td></tr></table>
<p style="margin:0">Find it in the menu: <b>Service &rsaquo; Courtesy Cars</b>.</p>
${o.receptionManager ? `<p style="margin:10px 0 0">As <b>reception manager</b> you also set each car&rsquo;s condition (maintenance, accident, on hold) and edit your branch&rsquo;s terms in the <b>Terms</b> tab.</p>` : ""}
</td></tr>
<tr><td style="padding:0 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${step(1, "The customer fills in the form", "Scans the QR code at reception or opens your link, in English or Arabic. A red * means mandatory. Signs on the phone.", phones)}
${step(2, "You are told at once", "An e-mail and a portal notification. The customer shows under <b>Waiting for a car</b> &ndash; press <b>Hand over a car</b>.", pic("agreements.jpg"))}
${step(3, "Hand the car over", "Choose an available car, type km and fuel, tap the drawing for each scratch or dent, add photos and sign.", pic("damage.jpg"))}
${step(4, "Print the agreement", "Press <b>Agreement PDF</b>. The Vehicle Gate Pass is already filled in on the last page.", pic("pdf-gatepass.jpg"))}
${step(5, "Take the car back", "Open the loan, press <b>Return the car</b>: km, fuel, new damage, photos, sign. The car is available again.", pic("detail.jpg"))}
${step(6, "Follow your cars", "<b>Dashboard &rsaquo; Service &rsaquo; Courtesy Cars</b>: on loan, available, overdue and service due.", pic("dashview.jpg"))}
</table></td></tr>
<tr><td style="padding:22px 28px 26px">
<p style="margin:0 0 12px">Any problem signing in? Reply to this e-mail or contact the Warranty team.</p>
<p style="margin:0">Best regards,<br><b>${esc(o.senderName)}</b><br>Warranty Team &ndash; Jiad Modern Motors</p>
<p style="margin:14px 0 0;color:#8a8f98;font-size:12px">Customer details in the pictures are blurred; the PDF shows sample data.</p></td></tr>
</table></div>`;
}

/** Sends the welcome e-mail (with the guide pictures inside it) to a new service advisor / reception account. */
export async function sendCourtesyWelcome(o: { name: string; email: string; tempPassword: string; receptionManager: boolean; senderName: string; site: string; sentBy?: string | null }): Promise<SendMailResult> {
  const dir = path.join(process.cwd(), "public", "courtesy", "guide");
  const attachments: MailAttachment[] = await Promise.all(GUIDE.map(async (g) => ({ filename: g.file, mimeType: "image/jpeg", data: await readFile(path.join(dir, g.file)), cid: cidOf(g.file) })));
  const text = [
    `Dear ${o.name.trim().split(/\s+/)[0] || "colleague"},`,
    "",
    "Your account for the MG Warranty portal is ready. From today all courtesy car agreements are made in the portal.",
    "",
    `Link: ${o.site}`,
    `E-mail: ${o.email}`,
    `Temporary password: ${o.tempPassword}`,
    "You choose your own password the first time you sign in.",
    "",
    "Find it in the menu: Service > Courtesy Cars.",
    "1. The customer fills in the form (QR code or your link) and signs.",
    "2. You get an e-mail and a portal notification - press Hand over a car.",
    "3. Hand the car over: km, fuel, damage marks, photos, sign.",
    "4. Print the Agreement PDF (the gate pass is on the last page).",
    "5. When the car comes back, press Return the car.",
    "6. Follow your cars in Dashboard > Service > Courtesy Cars.",
    "",
    `Best regards,\n${o.senderName}\nWarranty Team - Jiad Modern Motors`,
  ].join("\n");
  return sendMail({
    kind: "courtesy-welcome",
    to: [o.email],
    subject: "Your MG Warranty portal account – Courtesy Cars Version 2",
    text,
    html: welcomeHtml(o),
    attachments,
    sentBy: o.sentBy ?? null,
  });
}

/** Who gets the welcome e-mail: service advisors and the reception team (queue advisors and reception managers). */
export const getsCourtesyWelcome = (role: string, queueRole: string | null) => role === "service_advisor" || (role === "queue_user" && (queueRole === "advisor" || queueRole === "manager"));
