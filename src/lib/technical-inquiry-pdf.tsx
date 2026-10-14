import "server-only";
import React from "react";
import { Document, Font, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { createAdminClient } from "@/lib/supabase/admin";
import { TAJAWAL_BOLD, TAJAWAL_REGULAR } from "@/assets/fonts/tajawal-data";
import { createFileWithBytes, getDriveStatus, replaceFileBytes } from "@/lib/google-drive";
import { BRAND, INK, LINE, MUTED, QR_BOX, align, brandLockup, qrBlock } from "@/lib/rejected-claims-logbook";
import { OCCURRENCE_LABEL, PRIORITY_LABEL, ROLE_LABEL, STATUS_LABEL, SYSTEM_LABEL, formatMileage, inquiryLabel, type InquiryPriority, type InquiryStatus, type InquirySystem } from "@/lib/technical-inquiries";

/**
 * The case sheet: one PDF per technical inquiry, kept in the case's Drive folder next to its photos and videos, with
 * everything the portal holds about the case (the fault details, the conversation, the solution, the list of files)
 * and a QR code that opens the folder. Internal notes of the technical team are never in it - the folder is open to the
 * workshop. It is rewritten whenever the case changes, replacing the previous version in place (same link).
 */

Font.register({
  family: "Tajawal",
  fonts: [
    { src: TAJAWAL_REGULAR, fontWeight: 400 },
    { src: TAJAWAL_BOLD, fontWeight: 700 },
  ],
});
Font.registerHyphenationCallback((word) => [word]);

const h = React.createElement;
const stamp = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" });

type Inquiry = NonNullable<Awaited<ReturnType<typeof loadInquiry>>>;

async function loadInquiry(id: string) {
  const admin = createAdminClient();
  const { data: inquiry } = await admin.from("self_audit_technical_inquiries").select("*").eq("id", id).maybeSingle();
  if (!inquiry) return null;
  const [{ data: branch }, { data: comments }, { data: files }] = await Promise.all([
    admin.from("self_audit_branches").select("name").eq("id", inquiry.branch_id).maybeSingle(),
    // Internal notes stay out of the PDF.
    admin.from("self_audit_technical_inquiry_comments").select("id, kind, body, author_name, author_role, created_at").eq("inquiry_id", id).eq("internal", false).order("created_at"),
    admin.from("self_audit_technical_inquiry_attachments").select("comment_id, file_name, size_bytes, created_at").eq("inquiry_id", id).order("created_at"),
  ]);
  return { inquiry, branchName: branch?.name ?? "Branch", comments: comments ?? [], files: files ?? [] };
}

const EVENT_TEXT: Record<string, string> = {
  closed: "Case closed",
  reopened: "Case reopened",
  cancelled: "Case cancelled by the workshop",
  resubmitted: "Case sent again by the workshop",
  assigned: "Case assigned",
};

function caseDocument(s: Inquiry, folderUrl: string) {
  const { inquiry: q } = s;
  const label = inquiryLabel(q.inquiry_no);
  const fileCountFor = (commentId: string | null) => s.files.filter((f) => f.comment_id === commentId);

  const row = (name: string, value: string | null | undefined) =>
    value
      ? h(
          View,
          { key: name, style: { flexDirection: "row", marginBottom: 4 } },
          h(Text, { style: { width: 120, color: MUTED, fontSize: 9 } }, name),
          h(Text, { style: { flex: 1, fontWeight: 700, fontSize: 10, textAlign: align(value) } }, value)
        )
      : null;

  const block = (title: string, text: string | null | undefined) =>
    text
      ? h(
          View,
          { key: title, style: { borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 10, marginBottom: 10 } },
          h(Text, { style: { fontSize: 9, color: MUTED, marginBottom: 3 } }, title),
          h(Text, { style: { fontSize: 10.5, lineHeight: 1.5, textAlign: align(text) } }, text)
        )
      : null;

  const filesList = (files: { file_name: string; size_bytes: number }[]) =>
    files.length === 0
      ? null
      : h(Text, { style: { fontSize: 8.5, color: MUTED, marginTop: 3 } }, `Files: ${files.map((f) => f.file_name).join(", ")}`);

  const generatedAt = stamp(new Date().toISOString());

  return h(
    Document,
    { title: `Technical inquiry ${label}`, author: "Warranty Management Portal", subject: "Technical Inquiries" },
    h(
      Page,
      { size: "A4", style: { paddingTop: 26, paddingBottom: 56, paddingHorizontal: 40, fontFamily: "Tajawal", fontSize: 10, color: INK } },
      h(
        View,
        { style: { borderBottomWidth: 2, borderBottomColor: BRAND, paddingBottom: 14, marginBottom: 16 } },
        h(View, { style: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginHorizontal: -14 } }, brandLockup(QR_BOX), qrBlock(folderUrl, ["SCAN TO OPEN THE", "DRIVE FOLDER"])),
        h(
          View,
          { style: { alignItems: "center", marginTop: -24 } },
          h(Text, { style: { fontSize: 9, color: MUTED, fontWeight: 700, letterSpacing: 1.5, textAlign: "center" } }, "TECHNICAL INQUIRIES"),
          h(Text, { style: { fontSize: 24, color: BRAND, fontWeight: 700, letterSpacing: 2, marginTop: 2, textAlign: "center" } }, "CASE REPORT"),
          h(View, { style: { width: 36, height: 2, backgroundColor: BRAND, marginTop: 8, marginBottom: 8 } }),
          h(Text, { style: { fontSize: 17, fontWeight: 700, letterSpacing: 0.5, textAlign: "center" } }, `${label} - ${q.work_order_no}`),
          h(Text, { style: { fontSize: 10, color: MUTED, marginTop: 2, textAlign: "center" } }, `${s.branchName} - ${STATUS_LABEL[q.status as InquiryStatus]}`)
        )
      ),
      h(
        View,
        { style: { marginBottom: 12 } },
        row("Work order", q.work_order_no),
        row("VIN", q.vin),
        row("Vehicle model", q.vehicle_model),
        row("System", SYSTEM_LABEL[q.system as InquirySystem] ?? q.system),
        row("Priority", PRIORITY_LABEL[q.priority as InquiryPriority] ?? q.priority),
        row("Mileage", formatMileage(q.mileage_km)),
        row("Fault codes (DTC)", q.dtc_codes),
        row("Software / ECU version", q.software_version),
        row("Occurs", q.occurrence ? `${OCCURRENCE_LABEL[q.occurrence] ?? q.occurrence}${q.occurrence_conditions ? ` - ${q.occurrence_conditions}` : ""}` : q.occurrence_conditions),
        row("Parts already replaced", q.parts_replaced),
        row("Submitted by", `${q.created_by_name ?? "Unknown"} - ${stamp(q.created_at)}`),
        row("Technician", q.assigned_to_name),
        row("First answer", q.first_response_at ? stamp(q.first_response_at) : null),
        row("Closed", q.closed_at ? `${stamp(q.closed_at)}${q.closed_by_name ? ` by ${q.closed_by_name}` : ""}` : null)
      ),
      block("Fault complaint", q.fault_complaint),
      block("What the workshop did", q.actions_taken),
      block("Comments of the workshop", q.workshop_comments),
      q.resolution ? block("Solution", q.resolution) : null,
      fileCountFor(null).length > 0 ? h(View, { style: { marginBottom: 10 } }, h(Text, { style: { fontSize: 9, color: MUTED } }, "Files attached to the case"), filesList(fileCountFor(null))) : null,
      h(Text, { style: { fontSize: 12, fontWeight: 700, marginTop: 6, marginBottom: 8 } }, `Conversation (${s.comments.length})`),
      s.comments.length === 0
        ? h(Text, { style: { color: MUTED, fontSize: 10 } }, "No replies yet.")
        : h(
            View,
            null,
            ...s.comments.map((c, i) =>
              h(
                View,
                { key: c.id, wrap: false, style: { borderBottomWidth: i === s.comments.length - 1 ? 0 : 1, borderBottomColor: LINE, paddingBottom: 8, marginBottom: 8 } },
                h(
                  Text,
                  { style: { fontSize: 9, color: MUTED, marginBottom: 3 } },
                  `${c.kind === "comment" ? "" : `${EVENT_TEXT[c.kind] ?? c.kind} - `}${c.author_name ?? "Unknown"} (${ROLE_LABEL[c.author_role ?? ""] ?? c.author_role ?? "-"}) - ${stamp(c.created_at)}`
                ),
                c.body ? h(Text, { style: { fontSize: 10.5, lineHeight: 1.5, textAlign: align(c.body) } }, c.body) : null,
                c.kind === "comment" ? filesList(fileCountFor(c.id)) : null
              )
            )
          ),
      h(
        View,
        { fixed: true, style: { position: "absolute", bottom: 24, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: LINE, paddingTop: 6 } },
        h(Text, { style: { fontSize: 8, color: MUTED } }, `${label} - generated ${generatedAt}.`),
        h(Text, { style: { fontSize: 8, color: MUTED }, render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) => `Page ${pageNumber} of ${totalPages}` })
      )
    )
  );
}

/**
 * Rewrites the case sheet in the case's Drive folder (creating it the first time). Never throws: the case is already
 * saved, so a Drive problem must not undo it. If something new arrived while the PDF was being drawn it runs once more,
 * so the file cannot stay one reply behind.
 */
export async function syncInquiryPdf(inquiryId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!(await getDriveStatus())) return { ok: false, error: "Google Drive is not connected." };
    const admin = createAdminClient();
    for (let attempt = 0; attempt < 2; attempt++) {
      const snapshot = await loadInquiry(inquiryId);
      if (!snapshot) return { ok: false, error: "Inquiry not found." };
      const { data: folder } = await admin.from("self_audit_drive_folders").select("drive_id").eq("key", `inquiry:case:${inquiryId}`).maybeSingle();
      if (!folder) return { ok: false, error: "The case has no Drive folder yet." };

      const buffer = await renderToBuffer(caseDocument(snapshot, `https://drive.google.com/drive/folders/${folder.drive_id}`) as Parameters<typeof renderToBuffer>[0]);
      const bytes = new Uint8Array(buffer);
      const q = snapshot.inquiry;
      let fileId = q.pdf_drive_file_id;
      if (!fileId || !(await replaceFileBytes(fileId, "application/pdf", bytes))) {
        fileId = await createFileWithBytes({ parentId: folder.drive_id, name: `${inquiryLabel(q.inquiry_no)} - Case report.pdf`, mimeType: "application/pdf", bytes });
        await admin.from("self_audit_technical_inquiries").update({ pdf_drive_file_id: fileId }).eq("id", inquiryId);
      }

      const [{ count: comments }, { count: files }, { data: latest }] = await Promise.all([
        admin.from("self_audit_technical_inquiry_comments").select("id", { count: "exact", head: true }).eq("inquiry_id", inquiryId).eq("internal", false),
        admin.from("self_audit_technical_inquiry_attachments").select("id", { count: "exact", head: true }).eq("inquiry_id", inquiryId),
        admin.from("self_audit_technical_inquiries").select("updated_at").eq("id", inquiryId).maybeSingle(),
      ]);
      if (comments === snapshot.comments.length && files === snapshot.files.length && latest?.updated_at === q.updated_at) return { ok: true };
    }
    return { ok: true };
  } catch (e) {
    console.error("Technical inquiry PDF failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: e instanceof Error ? e.message : "The case sheet could not be saved to Drive." };
  }
}
