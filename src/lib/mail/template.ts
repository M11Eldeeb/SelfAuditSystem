// The look of the portal's automatic e-mails. Pure functions - used on the server to build the
// message (plain text + HTML) and in tests; no secrets and nothing server-only in here.

export const MAIL_SIGNATURE = "Warranty Department - Jiad Modern Motors";

export type MailBlock =
  | { type: "p"; text: string }
  | { type: "note"; text: string }
  | { type: "link"; label: string; url: string }
  | { type: "podium"; entries: { place: 1 | 2 | 3; name: string; pct: string }[] };

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const ORDINAL = { 1: "1st", 2: "2nd", 3: "3rd" } as const;

/** The podium as a table (the one layout every mail app draws the same): 2nd, 1st, 3rd with blocks of different heights. */
function podiumHtml(entries: { place: 1 | 2 | 3; name: string; pct: string }[]): string {
  const style = {
    1: { height: 96, bg: "#e4002b", fg: "#ffffff", medal: "#f5b800" },
    2: { height: 68, bg: "#6b7280", fg: "#ffffff", medal: "#c0c4cc" },
    3: { height: 50, bg: "#b45309", fg: "#ffffff", medal: "#d68a4d" },
  } as const;
  const byPlace = new Map(entries.map((e) => [e.place, e]));
  const cell = (place: 1 | 2 | 3) => {
    const e = byPlace.get(place);
    if (!e) return `<td width="33%"></td>`;
    const st = style[place];
    return `<td width="33%" valign="bottom" align="center" style="padding:0 4px">
<div style="font-size:13px;font-weight:700;color:#222;margin-bottom:6px">${escapeHtml(e.name)}</div>
<div style="background:${st.bg};color:${st.fg};height:${st.height}px;border-radius:6px 6px 0 0;text-align:center">
<div style="padding-top:10px"><span style="display:inline-block;width:26px;height:26px;line-height:26px;border-radius:13px;background:${st.medal};color:#222;font-weight:700;font-size:14px">${place}</span></div>
<div style="font-size:${place === 1 ? 22 : 18}px;font-weight:700;margin-top:4px">${escapeHtml(e.pct)}</div>
</div></td>`;
  };
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 20px"><tr>${cell(2)}${cell(1)}${cell(3)}</tr></table>`;
}

/**
 * Builds both versions of a mail from the same blocks. The plain-text version is exactly the wording
 * the warranty team approved ("Dear team," ... "Thank you," + signature); the HTML version is the same
 * words in a clean card with a button for the link.
 */
export function renderMail(blocks: MailBlock[], opts: { greeting?: string } = {}): { text: string; html: string } {
  const greeting = opts.greeting ?? "Dear team,";
  const text = [
    greeting,
    "",
    ...blocks
      .map((b) =>
        b.type === "link"
          ? `${b.label}: ${b.url}`
          : b.type === "note"
            ? `Note: ${b.text}`
            : b.type === "podium"
              ? b.entries.map((e) => `${ORDINAL[e.place]} - ${e.name} - ${e.pct}`).join("\n")
              : b.text
      )
      .flatMap((line) => [line, ""]),
    "Thank you,",
    MAIL_SIGNATURE,
  ].join("\n");

  const body = blocks
    .map((b) => {
      if (b.type === "podium") return podiumHtml(b.entries);
      if (b.type === "p") return `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#222">${escapeHtml(b.text)}</p>`;
      if (b.type === "note")
        return `<p style="margin:0 0 14px;padding:10px 12px;font-size:13px;line-height:1.5;color:#5a4a00;background:#fff8e1;border-left:3px solid #f0b400"><strong>Note:</strong> ${escapeHtml(b.text)}</p>`;
      return `<p style="margin:6px 0 18px"><a href="${escapeHtml(b.url)}" style="display:inline-block;padding:10px 20px;font-size:14px;font-weight:600;color:#fff;background:#e4002b;border-radius:6px;text-decoration:none">${escapeHtml(b.label)}</a></p>`;
    })
    .join("");

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e5e5">
<div style="height:4px;background:#e4002b"></div>
<div style="padding:24px 28px">
<p style="margin:0 0 16px;font-size:15px;color:#222">${escapeHtml(greeting)}</p>
${body}
<p style="margin:18px 0 0;font-size:15px;color:#222">Thank you,<br><strong>${escapeHtml(MAIL_SIGNATURE)}</strong></p>
</div>
<div style="padding:12px 28px;background:#fafafa;border-top:1px solid #eee;font-size:12px;color:#888">Automated mail from the Warranty Management Portal - please do not reply.</div>
</div></body></html>`;
  return { text, html };
}

/** "October 2026" for a date stored as "2026-10-01". */
export function monthLabel(date: string): string {
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "8 November 2026" in Saudi time. */
export function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Riyadh" });
}

/** Whole calendar days (Saudi time) from `from` to `to`; negative once `to` has passed. */
export function calendarDaysBetween(from: Date, to: Date): number {
  const day = (d: Date) => Math.floor((d.getTime() + 3 * 3_600_000) / 86_400_000);
  return day(to) - day(from);
}

/** The reminder milestone (7, 3 or 1 day left) a day count falls under, or null when it is still more than 7 days away or already past. */
export function reminderMilestone(daysLeft: number): 1 | 3 | 7 | null {
  if (daysLeft < 1) return null;
  return ([1, 3, 7] as const).find((m) => m >= daysLeft) ?? null;
}
