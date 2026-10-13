import "server-only";
import React from "react";
import { Document, Font, Image, Link, Page, Path, Svg, Text, View, renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import { createAdminClient } from "@/lib/supabase/admin";
import { TAJAWAL_BOLD, TAJAWAL_REGULAR } from "@/assets/fonts/tajawal-data";
import { MG_LOGO, MG_LOGO_HEIGHT, MG_LOGO_WIDTH } from "@/assets/mg-logo-data";
import { createFileWithBytes, ensureFolder, getDriveStatus, replaceFileBytes } from "@/lib/google-drive";

/**
 * The logbook: one PDF per work order, kept in that work order's Drive folder
 * next to its attachments, holding everything the website holds about the entry
 * (the rejection, every comment, the list of files) so the record survives
 * independently of the website. It is rebuilt whenever an entry or comment is
 * saved, replacing the previous version in place (same link).
 */

Font.register({
  family: "Tajawal",
  fonts: [
    { src: TAJAWAL_REGULAR, fontWeight: 400 },
    { src: TAJAWAL_BOLD, fontWeight: 700 },
  ],
});
Font.registerHyphenationCallback((word) => [word]); // never split a word (breaks Arabic joining)

const h = React.createElement;
const BRAND = "#e4002b";
const INK = "#171717";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";

/** Right-aligns a paragraph whose first letter is Arabic or Hebrew. */
function align(text: string): "left" | "right" {
  const firstLetter = text.match(/[A-Za-z֐-ࣿ]/)?.[0] ?? "";
  return /[֐-ࣿ]/.test(firstLetter) ? "right" : "left";
}

type Lang = "en" | "ar";

/** Every piece of fixed wording, once in English and once in Arabic (the report has a page in each). */
const TEXT = {
  en: {
    diary: "REJECTED CLAIMS DIARY",
    title: "LOGBOOK REPORT",
    rejectionDate: "Rejection date",
    claimNo: "Claim number",
    repeatOf: "Repeat of",
    repeatNote: (wo: string) => `${wo} (this work order was logged again)`,
    loggedBy: "Logged by",
    unknown: "Unknown",
    reason: "Reason for the rejection",
    info: "Additional information",
    customer: "Customer name",
    model: "Vehicle model",
    advisor: "Service advisor",
    leader: "Team leader",
    labours: "Labour description",
    parts: "Parts needed for the repair",
    comments: "Comments",
    noComments: "No comments yet.",
    team: " (Warranty team)",
    scan: ["SCAN TO OPEN THE", "DRIVE FOLDER"],
    generated: (wo: string, at: string) => `${wo} - generated ${at}.`,
    page: (n: number, total: number) => `Page ${n} of ${total}`,
  },
  ar: {
    diary: "دفتر المطالبات المرفوضة",
    title: "تقرير السجل",
    rejectionDate: "تاريخ الرفض",
    claimNo: "رقم المطالبة",
    repeatOf: "تكرار للطلب",
    repeatNote: (wo: string) => `تم تسجيل أمر العمل ${wo} مرة أخرى`,
    loggedBy: "سُجّل بواسطة",
    unknown: "غير معروف",
    reason: "سبب الرفض",
    info: "معلومات إضافية",
    customer: "اسم العميل",
    model: "طراز المركبة",
    advisor: "مستشار الخدمة",
    leader: "قائد الفريق",
    labours: "وصف العمل",
    parts: "قطع الغيار المطلوبة للإصلاح",
    comments: "التعليقات",
    noComments: "لا توجد تعليقات بعد.",
    team: " (فريق الضمان)",
    scan: ["امسح الرمز لفتح", "مجلد جوجل درايف"],
    generated: (_wo: string, at: string) => `أُنشئ في ${at}`,
    page: (n: number, total: number) => `صفحة ${n} من ${total}`,
  },
} as const;

const LOCALE: Record<Lang, string> = { en: "en-GB", ar: "ar-SA-u-ca-gregory-nu-latn" };
const stamp = (iso: string, lang: Lang) =>
  new Date(iso).toLocaleString(LOCALE[lang], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" });
const day = (d: string, lang: Lang) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(LOCALE[lang], { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

type Snapshot = {
  entry: {
    id: string;
    branch_id: string;
    work_order_no: string;
    claim_no: string | null;
    rejection_date: string;
    reason: string;
    created_by_name: string | null;
    duplicate_of: string | null;
    customer_name: string | null;
    vehicle_model: string | null;
    service_advisor: string | null;
    team_leader: string | null;
    labours: string[];
    parts: string[];
    created_at: string;
  };
  branchName: string;
  comments: { id: string; body: string; author_name: string | null; author_role: string | null; created_at: string }[];
  files: { comment_id: string | null; file_name: string; size_bytes: number; created_at: string }[];
};

async function loadSnapshot(entryId: string): Promise<Snapshot | null> {
  const admin = createAdminClient();
  const { data: entry } = await admin.from("self_audit_rejected_claims").select("*").eq("id", entryId).maybeSingle();
  if (!entry) return null;
  const [{ data: branch }, { data: comments }, { data: files }] = await Promise.all([
    admin.from("self_audit_branches").select("name").eq("id", entry.branch_id).maybeSingle(),
    admin.from("self_audit_rejected_claim_comments").select("id, body, author_name, author_role, created_at").eq("entry_id", entryId).order("created_at"),
    admin.from("self_audit_rejected_claim_attachments").select("comment_id, file_name, size_bytes, created_at").eq("entry_id", entryId).order("created_at"),
  ]);
  return { entry, branchName: branch?.name ?? "Branch", comments: comments ?? [], files: files ?? [] };
}

/**
 * A QR code as vector shapes (sharp at any zoom or print size) inside a white card
 * with a thin border, and a caption. Scanning it opens the work order's Drive folder.
 */
function qrBlock(url: string, caption: readonly [string, string]) {
  const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const quiet = 2; // modules of white around the code, so scanners find its edge
  let d = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.modules.get(x, y)) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  }
  const total = n + quiet * 2;
  return h(
    Link,
    { src: url, style: { textDecoration: "none", alignItems: "center", width: 84 } },
    h(
      View,
      { style: { padding: 4, borderWidth: 1, borderColor: LINE, borderRadius: 6, backgroundColor: "#ffffff" } },
      h(Svg, { width: 74, height: 74, viewBox: `0 0 ${total} ${total}` }, h(Path, { d, fill: INK }))
    ),
    h(Text, { style: { fontSize: 7, color: MUTED, marginTop: 4, textAlign: "center", letterSpacing: 0.4 } }, caption[0]),
    h(Text, { style: { fontSize: 7, color: MUTED, textAlign: "center", letterSpacing: 0.4 } }, caption[1])
  );
}

/**
 * The company mark: the MG octagon, a hairline, and the company name in Arabic and
 * English with the group line underneath. Typeset (not a screenshot) so it stays
 * sharp however far the PDF is zoomed or printed.
 */
function brandLockup() {
  const logoWidth = 34;
  return h(
    View,
    { style: { flexDirection: "row", alignItems: "center" } },
    h(Image, { src: MG_LOGO, style: { width: logoWidth, height: (logoWidth * MG_LOGO_HEIGHT) / MG_LOGO_WIDTH } }),
    h(View, { style: { width: 1, height: 32, backgroundColor: LINE, marginHorizontal: 9 } }),
    h(
      View,
      null,
      h(Text, { style: { fontSize: 12.5, fontWeight: 700, color: INK, textAlign: "right" } }, "جياد الحديثة للسيارات"),
      h(Text, { style: { fontSize: 11.5, fontWeight: 700, color: INK, letterSpacing: 0.2, textAlign: "right" } }, "Jiad Modern Motors"),
      h(Text, { style: { fontSize: 6.5, color: MUTED, marginTop: 1.5, textAlign: "right" } }, "A Mohamed Yousuf Naghi Company")
    )
  );
}

/** One report page in one language. The Arabic page mirrors the layout: right to left, logo at the right edge. */
function reportPage(s: Snapshot, folderUrl: string, lang: Lang) {
  const { entry } = s;
  const L = TEXT[lang];
  const rtl = lang === "ar";
  const dir = rtl ? "row-reverse" : "row";
  // An Arabic page is right-aligned throughout; the English page follows each paragraph's own script.
  const alignOf = (text: string): "left" | "right" => (rtl ? "right" : align(text));
  const generatedAt = stamp(new Date().toISOString(), lang);

  const row = (label: string, value: string, sub?: string) =>
    h(
      View,
      { style: { flexDirection: dir, marginBottom: 4 } },
      h(Text, { style: { width: rtl ? 120 : 110, color: MUTED, fontSize: 9, textAlign: rtl ? "right" : "left" } }, label),
      h(
        View,
        { style: { flex: 1 } },
        h(Text, { style: { fontWeight: 700, fontSize: 10, textAlign: rtl ? "right" : "left" } }, value),
        sub ? h(Text, { style: { fontSize: 8.5, color: MUTED, marginTop: 1, textAlign: rtl ? "right" : "left" } }, sub) : null
      )
    );

  const listBlock = (title: string, items: string[]) =>
    h(
      View,
      { style: { marginTop: 6, marginBottom: 2 } },
      h(Text, { style: { fontSize: 9, color: MUTED, marginBottom: 3, textAlign: rtl ? "right" : "left" } }, title),
      ...items.map((item, i) => {
        // An Arabic item reads right to left even on the English page: number on the right, text beside it.
        const itemRtl = alignOf(item) === "right";
        return h(
          View,
          { key: String(i), wrap: false, style: { flexDirection: itemRtl ? "row-reverse" : "row", marginBottom: 2.5 } },
          h(Text, { style: { width: 16, fontSize: 9, fontWeight: 700, color: BRAND, textAlign: itemRtl ? "right" : "left" } }, String(i + 1)),
          h(Text, { style: { flex: 1, fontSize: 10.5, lineHeight: 1.45, textAlign: itemRtl ? "right" : "left" } }, item)
        );
      })
    );

  // Only what the branch admin filled in is shown; with nothing, the whole section is left out.
  const details: [string, string][] = (
    [
      [L.customer, entry.customer_name],
      [L.model, entry.vehicle_model],
      [L.advisor, entry.service_advisor],
      [L.leader, entry.team_leader],
    ] as [string, string | null][]
  ).filter((d): d is [string, string] => !!d[1]);
  const hasInfo = details.length > 0 || entry.labours.length > 0 || entry.parts.length > 0;

  return h(
    Page,
    { key: lang, size: "A4", style: { paddingTop: 40, paddingBottom: 56, paddingHorizontal: 40, fontFamily: "Tajawal", fontSize: 10, color: INK } },
    h(
      View,
      { style: { borderBottomWidth: 2, borderBottomColor: BRAND, paddingBottom: 14, marginBottom: 16 } },
      // Letterhead: the company mark at one edge, the QR code at the other.
      h(View, { style: { flexDirection: dir, justifyContent: "space-between", alignItems: "center" } }, brandLockup(), qrBlock(folderUrl, L.scan)),
      // The title block sits centred underneath.
      h(
        View,
        { style: { alignItems: "center", marginTop: 4 } },
        h(Text, { style: { fontSize: 9, color: MUTED, fontWeight: 700, letterSpacing: rtl ? 0 : 1.5, textAlign: "center" } }, L.diary),
        h(Text, { style: { fontSize: 24, color: BRAND, fontWeight: 700, letterSpacing: rtl ? 0 : 2, marginTop: 2, textAlign: "center" } }, L.title),
        h(View, { style: { width: 36, height: 2, backgroundColor: BRAND, marginTop: 8, marginBottom: 8 } }),
        h(Text, { style: { fontSize: 17, fontWeight: 700, letterSpacing: 0.5, textAlign: "center" } }, entry.work_order_no),
        h(Text, { style: { fontSize: 10, color: MUTED, marginTop: 2, textAlign: "center" } }, s.branchName)
      )
    ),
    h(
      View,
      { style: { marginBottom: 12 } },
      row(L.rejectionDate, day(entry.rejection_date, lang)),
      row(L.claimNo, entry.claim_no ?? "-"),
      entry.duplicate_of ? row(L.repeatOf, L.repeatNote(entry.duplicate_of)) : null,
      rtl
        ? row(L.loggedBy, entry.created_by_name ?? L.unknown, stamp(entry.created_at, lang))
        : row(L.loggedBy, `${entry.created_by_name ?? L.unknown} - ${stamp(entry.created_at, lang)}`)
    ),
    h(
      View,
      { style: { borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 10, marginBottom: 16 } },
      h(Text, { style: { fontSize: 9, color: MUTED, marginBottom: 3, textAlign: rtl ? "right" : "left" } }, L.reason),
      h(Text, { style: { fontSize: 11, lineHeight: 1.5, textAlign: alignOf(entry.reason) } }, entry.reason)
    ),
    hasInfo
      ? h(
          View,
          { style: { marginBottom: 16 } },
          h(Text, { style: { fontSize: 12, fontWeight: 700, marginBottom: 8, textAlign: rtl ? "right" : "left" } }, L.info),
          details.length > 0 ? h(View, { style: { marginBottom: 2 } }, ...details.map(([label, value]) => row(label, value))) : null,
          entry.labours.length > 0 ? listBlock(L.labours, entry.labours) : null,
          entry.parts.length > 0 ? listBlock(L.parts, entry.parts) : null
        )
      : null,
    h(Text, { style: { fontSize: 12, fontWeight: 700, marginBottom: 8, textAlign: rtl ? "right" : "left" } }, `${L.comments} (${s.comments.length})`),
    s.comments.length === 0
      ? h(Text, { style: { color: MUTED, fontSize: 10, textAlign: rtl ? "right" : "left" } }, L.noComments)
      : h(
          View,
          null,
          ...s.comments.map((c, i) =>
            h(
              View,
              { key: c.id, wrap: false, style: { borderBottomWidth: i === s.comments.length - 1 ? 0 : 1, borderBottomColor: LINE, paddingBottom: 8, marginBottom: 8 } },
              rtl
                ? // Name and date are separate pieces so English names and Arabic dates do not scramble each other.
                  h(
                    View,
                    { style: { flexDirection: "row-reverse", marginBottom: 3 } },
                    h(Text, { style: { fontSize: 9, color: MUTED } }, `${i + 1}.`),
                    h(Text, { style: { fontSize: 9, color: MUTED, marginRight: 4 } }, `${c.author_name ?? L.unknown}${c.author_role === "officer" ? L.team : ""}`),
                    h(Text, { style: { fontSize: 9, color: MUTED, marginRight: 8 } }, stamp(c.created_at, lang))
                  )
                : h(
                    Text,
                    { style: { fontSize: 9, color: MUTED, marginBottom: 3 } },
                    `${i + 1}. ${c.author_name ?? L.unknown}${c.author_role === "officer" ? L.team : ""} - ${stamp(c.created_at, lang)}`
                  ),
              h(Text, { style: { fontSize: 10.5, lineHeight: 1.5, textAlign: alignOf(c.body) } }, c.body)
            )
          )
        ),
    h(
      View,
      { fixed: true, style: { position: "absolute", bottom: 24, left: 40, right: 40, flexDirection: dir, justifyContent: "space-between", borderTopWidth: 1, borderTopColor: LINE, paddingTop: 6 } },
      h(Text, { style: { fontSize: 8, color: MUTED } }, L.generated(entry.work_order_no, generatedAt)),
      h(Text, { style: { fontSize: 8, color: MUTED }, render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) => L.page(pageNumber, totalPages) })
    )
  );
}

/** The whole logbook: the English report, then the same report in Arabic on its own page(s). */
function logbookDocument(s: Snapshot, folderUrl: string) {
  return h(
    Document,
    { title: `Logbook Report - ${s.entry.work_order_no}`, author: "Warranty Management Portal", subject: "Rejected Claims Diary" },
    reportPage(s, folderUrl, "en"),
    reportPage(s, folderUrl, "ar")
  );
}

async function renderLogbook(snapshot: Snapshot, folderUrl: string): Promise<Uint8Array> {
  // react-pdf's element types are narrower than React's generic element; the document is valid.
  const buffer = await renderToBuffer(logbookDocument(snapshot, folderUrl) as Parameters<typeof renderToBuffer>[0]);
  return new Uint8Array(buffer);
}

const logbookKey = (branchId: string, workOrder: string) => `logbook:${branchId}:${workOrder}`;

/** The Drive file id of an entry's logbook, if one has been written. */
export async function getLogbookFileId(branchId: string, workOrder: string): Promise<string | null> {
  const { data } = await createAdminClient().from("self_audit_drive_folders").select("drive_id").eq("key", logbookKey(branchId, workOrder)).maybeSingle();
  return data?.drive_id ?? null;
}

/**
 * Rebuilds the logbook PDF and writes it into the work order's Drive folder
 * (creating the folders on first use, replacing the file on later runs). Never
 * throws: the entry is already saved, so a Drive hiccup must not undo it - the
 * result says what happened, and an officer can rebuild from the entry page.
 * If another comment landed while the PDF was being written it runs once more,
 * so the file cannot end up one comment behind.
 */
export async function syncLogbook(entryId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const drive = await getDriveStatus();
    if (!drive) return { ok: false, error: "Google Drive is not connected." };
    const admin = createAdminClient();

    for (let attempt = 0; attempt < 2; attempt++) {
      const snapshot = await loadSnapshot(entryId);
      if (!snapshot) return { ok: false, error: "Entry not found." };
      const { entry, branchName, comments, files } = snapshot;

      const branchFolder = await ensureFolder(`branch:${entry.branch_id}`, branchName, drive.rootFolderId);
      const entryFolder = await ensureFolder(`wo:${entry.branch_id}:${entry.work_order_no}`, entry.work_order_no, branchFolder);
      // The folder is known before the PDF is drawn, so its QR code can point there.
      const bytes = await renderLogbook(snapshot, `https://drive.google.com/drive/folders/${entryFolder}`);
      const key = logbookKey(entry.branch_id, entry.work_order_no);
      const existing = await getLogbookFileId(entry.branch_id, entry.work_order_no);

      let fileId = existing;
      if (!existing || !(await replaceFileBytes(existing, "application/pdf", bytes))) {
        fileId = await createFileWithBytes({ parentId: entryFolder, name: `Logbook Report - ${entry.work_order_no}.pdf`, mimeType: "application/pdf", bytes });
        await admin.from("self_audit_drive_folders").upsert({ key, drive_id: fileId });
      }

      // Did something new arrive while we were writing? Then go round again.
      const [{ count: commentCount }, { count: fileCount }] = await Promise.all([
        admin.from("self_audit_rejected_claim_comments").select("id", { count: "exact", head: true }).eq("entry_id", entryId),
        admin.from("self_audit_rejected_claim_attachments").select("id", { count: "exact", head: true }).eq("entry_id", entryId),
      ]);
      if (commentCount === comments.length && fileCount === files.length) return { ok: true };
    }
    return { ok: true };
  } catch (e) {
    console.error("Logbook PDF failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: e instanceof Error ? e.message : "The logbook could not be saved to Drive." };
  }
}
