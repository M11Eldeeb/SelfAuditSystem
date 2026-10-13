import "server-only";
import React from "react";
import { Document, Font, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { createAdminClient } from "@/lib/supabase/admin";
import { TAJAWAL_BOLD, TAJAWAL_REGULAR } from "@/assets/fonts/tajawal-data";
import { createFileWithBytes, ensureFolder, getDriveStatus, replaceFileBytes } from "@/lib/google-drive";
import { formatBytes } from "@/lib/feedback-constants";

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

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" });
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

type Snapshot = {
  entry: {
    id: string;
    branch_id: string;
    work_order_no: string;
    claim_no: string | null;
    rejection_date: string;
    reason: string;
    created_by_name: string | null;
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

function row(label: string, value: string) {
  return h(View, { style: { flexDirection: "row", marginBottom: 4 } }, h(Text, { style: { width: 110, color: MUTED, fontSize: 9 } }, label), h(Text, { style: { flex: 1, fontWeight: 700, fontSize: 10 } }, value));
}

function fileList(files: Snapshot["files"]) {
  if (files.length === 0) return null;
  return h(
    View,
    { style: { marginTop: 6 } },
    ...files.map((f, i) => h(Text, { key: i, style: { fontSize: 9, color: MUTED, marginBottom: 2 } }, `Attached: ${f.file_name} (${formatBytes(f.size_bytes)})`))
  );
}

function logbookDocument(s: Snapshot, generatedAt: string) {
  const { entry } = s;
  const entryFiles = s.files.filter((f) => f.comment_id === null);

  return h(
    Document,
    { title: `Logbook - ${entry.work_order_no}`, author: "Warranty Management Portal", subject: "Rejected Claims Diary" },
    h(
      Page,
      { size: "A4", style: { paddingTop: 40, paddingBottom: 56, paddingHorizontal: 40, fontFamily: "Tajawal", fontSize: 10, color: INK } },
      h(View, { style: { borderBottomWidth: 2, borderBottomColor: BRAND, paddingBottom: 8, marginBottom: 14 } },
        h(Text, { style: { fontSize: 9, color: BRAND, fontWeight: 700, letterSpacing: 1 } }, "REJECTED CLAIMS DIARY - LOGBOOK"),
        h(Text, { style: { fontSize: 20, fontWeight: 700, marginTop: 2 } }, entry.work_order_no),
        h(Text, { style: { fontSize: 10, color: MUTED } }, s.branchName)
      ),
      h(View, { style: { marginBottom: 12 } },
        row("Rejection date", day(entry.rejection_date)),
        row("Claim number", entry.claim_no ?? "-"),
        row("Logged by", `${entry.created_by_name ?? "Unknown"} - ${stamp(entry.created_at)}`)
      ),
      h(View, { style: { borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 10, marginBottom: 16 } },
        h(Text, { style: { fontSize: 9, color: MUTED, marginBottom: 3 } }, "Reason for the rejection"),
        h(Text, { style: { fontSize: 11, lineHeight: 1.5, textAlign: align(entry.reason) } }, entry.reason),
        fileList(entryFiles)
      ),
      h(Text, { style: { fontSize: 12, fontWeight: 700, marginBottom: 8 } }, `Comments (${s.comments.length})`),
      s.comments.length === 0
        ? h(Text, { style: { color: MUTED, fontSize: 10 } }, "No comments yet.")
        : h(
            View,
            null,
            ...s.comments.map((c, i) =>
              h(
                View,
                { key: c.id, wrap: false, style: { borderBottomWidth: i === s.comments.length - 1 ? 0 : 1, borderBottomColor: LINE, paddingBottom: 8, marginBottom: 8 } },
                h(Text, { style: { fontSize: 9, color: MUTED, marginBottom: 3 } }, `${i + 1}. ${c.author_name ?? "Unknown"}${c.author_role === "officer" ? " (Warranty team)" : ""} - ${stamp(c.created_at)}`),
                h(Text, { style: { fontSize: 10.5, lineHeight: 1.5, textAlign: align(c.body) } }, c.body),
                fileList(s.files.filter((f) => f.comment_id === c.id))
              )
            )
          ),
      h(
        View,
        { fixed: true, style: { position: "absolute", bottom: 24, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: LINE, paddingTop: 6 } },
        h(Text, { style: { fontSize: 8, color: MUTED } }, `${entry.work_order_no} - generated ${generatedAt}. Files are in the same Drive folder.`),
        h(Text, { style: { fontSize: 8, color: MUTED }, render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) => `Page ${pageNumber} of ${totalPages}` })
      )
    )
  );
}

export async function buildLogbookPdf(entryId: string): Promise<{ bytes: Uint8Array; snapshot: Snapshot } | null> {
  const snapshot = await loadSnapshot(entryId);
  if (!snapshot) return null;
  const generatedAt = stamp(new Date().toISOString());
  // react-pdf's element types are narrower than React's generic element; the document is valid.
  const buffer = await renderToBuffer(logbookDocument(snapshot, generatedAt) as Parameters<typeof renderToBuffer>[0]);
  return { bytes: new Uint8Array(buffer), snapshot };
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
      const built = await buildLogbookPdf(entryId);
      if (!built) return { ok: false, error: "Entry not found." };
      const { entry, branchName, comments, files } = built.snapshot;

      const branchFolder = await ensureFolder(`branch:${entry.branch_id}`, branchName, drive.rootFolderId);
      const entryFolder = await ensureFolder(`wo:${entry.branch_id}:${entry.work_order_no}`, entry.work_order_no, branchFolder);
      const key = logbookKey(entry.branch_id, entry.work_order_no);
      const existing = await getLogbookFileId(entry.branch_id, entry.work_order_no);

      let fileId = existing;
      if (!existing || !(await replaceFileBytes(existing, "application/pdf", built.bytes))) {
        fileId = await createFileWithBytes({ parentId: entryFolder, name: `Logbook - ${entry.work_order_no}.pdf`, mimeType: "application/pdf", bytes: built.bytes });
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
