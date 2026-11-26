// The welcome e-mail for a new quality controller: the sign-in (with a temporary password) and a short guide to the QC
// pages. Plain building blocks (no server imports) so the e-mail can also be previewed.

const RED = "#c4121a";
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type QcWelcome = { name: string; email: string; tempPassword: string; branch: string; senderName: string; site: string };

const STEPS: { title: string; body: string }[] = [
  {
    title: "Sign in",
    body: "Open the link on your phone or computer and sign in with the e-mail and temporary password above. You choose your own password the first time. In the menu: <b>QC records</b>, with the <b>+ New QC</b> button on it.",
  },
  {
    title: "Start a new QC",
    body: "Press <b>New QC</b> and type the 5-digit WIP number. The VIN, model, odometer and service advisor are filled in from the Open WIPs report. Choose the purpose (Quality Control or Back Job), the technician(s), the team leader and the repair type.",
  },
  {
    title: "Fill in the inspection sheet",
    body: "For each item tap <b>Good</b>, <b>Inspect</b> or <b>Repair</b>. <b>All good</b> marks a whole section at once. Add the tire pressures and brake readings, or tap <b>All good</b> for them.",
  },
  {
    title: "Give the result",
    body: "<b>Pass</b> closes the case. <b>Fail</b> sends the vehicle back to the workshop: write what must be fixed. Enter the current odometer and attach photos or videos with <b>Camera</b> or <b>Choose files</b>, then press <b>Submit</b>. <b>Save</b> keeps the form to finish later.",
  },
  {
    title: "Test it again",
    body: "Failed vehicles wait under <b>QC records &rsaquo; Waiting for retest</b>. Open the vehicle when the workshop is done and test it again, as many times as needed.",
  },
  {
    title: "Close as failed (only when it cannot be retested)",
    body: "If the vehicle cannot be tested again, use <b>Close as failed</b>: write the justification, the 5 Whys, the root cause, the solution, and who it is assigned to (team leader or workshop supervisor).",
  },
  {
    title: "Reports",
    body: "Every QC has a <b>Print report (PDF)</b> button. Your branch&rsquo;s figures (first-time pass rate, fails, waiting vehicles) are in the <b>Quality Dashboard</b>.",
  },
];

function step(num: number, title: string, body: string) {
  return `<tr><td style="padding:14px 0 4px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:top;padding-right:12px"><div style="width:30px;height:30px;border-radius:15px;background:${RED};color:#fff;font-weight:700;text-align:center;line-height:30px">${num}</div></td>
<td style="vertical-align:top"><div style="font-size:16px;font-weight:700;color:#1c1f24">${title}</div><div style="color:#4a5260;margin-top:2px">${body}</div></td></tr></table></td></tr>`;
}

export function qcWelcomeHtml(o: QcWelcome) {
  const first = esc(o.name.trim().split(/\s+/)[0] || "colleague");
  return `<div style="background:#f3f1ee;padding:24px 0;font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1c1f24">
<table role="presentation" width="640" align="center" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;margin:0 auto">
<tr><td style="background:#16191d;border-radius:14px 14px 0 0;padding:22px 28px">
<div style="color:${RED};font-weight:800;letter-spacing:2px;font-size:13px">MG WARRANTY PORTAL</div>
<div style="color:#f3f1ee;font-size:24px;font-weight:800;margin-top:4px">Quality Control</div>
<div style="color:#c9cdd3;font-size:14px">Your account is ready &ndash; ${esc(o.branch)}</div></td></tr>
<tr><td style="padding:24px 28px 8px">
<p style="margin:0 0 12px">Dear ${first},</p>
<p style="margin:0 0 12px">Your quality controller account for the <b>MG Warranty portal</b> is ready. From now on every QC test for <b>${esc(o.branch)}</b> is recorded in the portal.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f5f2;border-left:4px solid ${RED};margin:6px 0 14px"><tr><td style="padding:12px 16px">
<b>Your sign-in</b><br>Link: <a href="${o.site}" style="color:${RED}">${o.site}</a><br>
E-mail: ${esc(o.email)}<br>Temporary password: <b style="font-family:Consolas,monospace">${esc(o.tempPassword)}</b><br>
<span style="color:#4a5260;font-size:13px">You choose your own password the first time you sign in. Please do not share it.</span></td></tr></table>
<p style="margin:0;font-size:16px;font-weight:700">How to use it</p>
</td></tr>
<tr><td style="padding:0 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${STEPS.map((s, i) => step(i + 1, s.title, s.body)).join("\n")}
</table></td></tr>
<tr><td style="padding:22px 28px 26px">
<p style="margin:0 0 12px">Any problem signing in? Reply to this e-mail or contact the Warranty team.</p>
<p style="margin:0">Best regards,<br><b>${esc(o.senderName)}</b><br>Warranty Team &ndash; Jiad Modern Motors</p></td></tr>
</table></div>`;
}

const plain = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&rsaquo;/g, ">").replace(/&rsquo;/g, "'").replace(/&ndash;/g, "-");

export function qcWelcomeText(o: QcWelcome) {
  return [
    `Dear ${o.name.trim().split(/\s+/)[0] || "colleague"},`,
    "",
    `Your quality controller account for the MG Warranty portal is ready. From now on every QC test for ${o.branch} is recorded in the portal.`,
    "",
    `Link: ${o.site}`,
    `E-mail: ${o.email}`,
    `Temporary password: ${o.tempPassword}`,
    "You choose your own password the first time you sign in.",
    "",
    "How to use it:",
    ...STEPS.map((s, i) => `${i + 1}. ${s.title}: ${plain(s.body)}`),
    "",
    `Best regards,\n${o.senderName}\nWarranty Team - Jiad Modern Motors`,
  ].join("\n");
}

export const QC_WELCOME_SUBJECT = "Your MG Warranty portal account – Quality Control";
