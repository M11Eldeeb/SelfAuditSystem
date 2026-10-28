"use server";

import { headers } from "next/headers";
import { requireRole, requireViewer } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";
import { DocsError, getDocsConnection, startDocsUpload } from "@/lib/documents/drive-docs";
import { driveFileInfo, ensureFolder, trashDriveFile } from "@/lib/tech-claims/drive";

/** SAIC pays a payment order within this many months of its creation date; later = overdue. */
const REMIT_MONTHS = 3;

export type PaymentSettlement = { settlementOrder: string; claims: number; settled: number; avgDays: number | null };
export type PaymentFile = { id: string; driveId: string; name: string; size: number; at: string; by: string | null };
export type PaymentRow = {
  paymentOrder: string;
  creationDate: string | null;
  dueDate: string | null;
  totalVat: number;
  currency: string;
  saicStatus: string | null;
  remitStatus: "pending" | "remitted";
  remittedAt: string | null;
  receivedAmount: number | null;
  notes: string | null;
  claims: number;
  settledByClaims: number;
  avgDays: number | null;
  settlements: PaymentSettlement[];
  files: PaymentFile[];
  driveFolderId: string | null;
  updatedBy: string | null;
};
export type PendingMonth = { month: string; claims: number; amount: number };
export type PaymentsData = { rows: PaymentRow[]; pendingByMonth: PendingMonth[]; today: string; remitMonths: number; officerName: string };

const todayKsa = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const addMonths = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};

/** Officers: every payment order with its settlement orders, claims, average settlement time and evidence. */
export async function getPaymentsData(): Promise<PaymentsData> {
  const officer = await requireViewer("officer");
  const admin = createAdminClient();
  const [{ data: orders }, { data: breakdown }, { data: files }, { data: pending }] = await Promise.all([
    admin.from("self_audit_payment_orders").select("*").order("creation_date", { ascending: false }),
    admin.rpc("payment_order_breakdown"),
    admin.from("self_audit_payment_files").select("id, payment_order, drive_file_id, file_name, size_bytes, created_at, uploaded_by_name").order("created_at"),
    admin.rpc("pending_settlement_by_month"),
  ]);
  const byPo = new Map<string, PaymentSettlement[]>();
  for (const b of breakdown ?? []) {
    const list = byPo.get(b.payment_order) ?? [];
    list.push({ settlementOrder: b.settlement_order ?? "—", claims: Number(b.claims), settled: Number(b.settled ?? 0), avgDays: b.avg_days == null ? null : Number(b.avg_days) });
    byPo.set(b.payment_order, list);
  }
  const filesByPo = new Map<string, PaymentFile[]>();
  for (const f of files ?? []) {
    const list = filesByPo.get(f.payment_order) ?? [];
    list.push({ id: f.id, driveId: f.drive_file_id, name: f.file_name, size: Number(f.size_bytes), at: f.created_at, by: f.uploaded_by_name });
    filesByPo.set(f.payment_order, list);
  }
  const rows: PaymentRow[] = (orders ?? []).map((o) => {
    const settlements = (byPo.get(o.payment_order) ?? []).sort((a, b) => a.settlementOrder.localeCompare(b.settlementOrder));
    const claims = settlements.reduce((s, x) => s + x.claims, 0);
    const weighted = settlements.reduce((s, x) => s + (x.avgDays ?? 0) * x.claims, 0);
    const withDays = settlements.filter((x) => x.avgDays != null).reduce((s, x) => s + x.claims, 0);
    return {
      paymentOrder: o.payment_order,
      creationDate: o.creation_date,
      dueDate: o.creation_date ? addMonths(o.creation_date, REMIT_MONTHS) : null,
      totalVat: Number(o.total_vat),
      currency: o.currency,
      saicStatus: o.saic_status,
      remitStatus: o.remit_status,
      remittedAt: o.remitted_at,
      receivedAmount: o.received_amount == null ? null : Number(o.received_amount),
      notes: o.notes,
      claims,
      settledByClaims: settlements.reduce((s, x) => s + x.settled, 0),
      avgDays: withDays ? Math.round((weighted / withDays) * 10) / 10 : null,
      settlements,
      files: filesByPo.get(o.payment_order) ?? [],
      driveFolderId: o.drive_folder_id,
      updatedBy: o.updated_by_name,
    };
  });
  return {
    rows,
    pendingByMonth: (pending ?? []).map((p) => ({ month: p.month, claims: Number(p.claims), amount: Number(p.amount ?? 0) })).sort((a, b) => a.month.localeCompare(b.month)),
    today: todayKsa(),
    remitMonths: REMIT_MONTHS,
    officerName: officer.full_name ?? officer.email,
  };
}

/** Officers: pending / remitted, the amount actually received (optional) and notes. */
export async function savePayment(
  paymentOrder: string,
  patch: { remitStatus?: "pending" | "remitted"; receivedAmount?: number | null; notes?: string | null }
): Promise<{ error?: string }> {
  const officer = await requireRole("officer");
  const update: Database["public"]["Tables"]["self_audit_payment_orders"]["Update"] = {
    updated_by: officer.id,
    updated_by_name: officer.full_name ?? officer.email,
    updated_at: new Date().toISOString(),
  };
  if (patch.remitStatus) {
    update.remit_status = patch.remitStatus;
    update.remitted_at = patch.remitStatus === "remitted" ? todayKsa() : null;
  }
  if (patch.receivedAmount !== undefined) {
    if (patch.receivedAmount != null && !(Number.isFinite(patch.receivedAmount) && patch.receivedAmount >= 0)) return { error: "Enter a valid amount." };
    update.received_amount = patch.receivedAmount;
  }
  if (patch.notes !== undefined) update.notes = patch.notes?.trim().slice(0, 2000) || null;
  const { error } = await createAdminClient().from("self_audit_payment_orders").update(update).eq("payment_order", paymentOrder);
  return error ? { error: error.message } : {};
}

/** Monthly Warranty Payments / <Payment order>-<Creation date> on the documents' Google Drive (made when first needed). */
async function paymentFolder(paymentOrder: string): Promise<string> {
  const admin = createAdminClient();
  const { data: po } = await admin.from("self_audit_payment_orders").select("creation_date, drive_folder_id").eq("payment_order", paymentOrder).maybeSingle();
  if (!po) throw new DocsError("Payment order not found.");
  if (po.drive_folder_id) {
    const info = await driveFileInfo(po.drive_folder_id);
    if (info && !info.trashed) return po.drive_folder_id;
  }
  const root = await ensureFolder("root", "Monthly Warranty Payments", "pay:root");
  const id = await ensureFolder(root, `${paymentOrder}-${po.creation_date ?? "no date"}`);
  await admin.from("self_audit_payment_orders").update({ drive_folder_id: id }).eq("payment_order", paymentOrder);
  return id;
}

const safeName = (n: string) => n.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim().slice(0, 200) || "file";

/** Officers: upload sessions for payment evidence (the browser sends the files straight to Google Drive). */
export async function preparePaymentUploads(paymentOrder: string, files: { name: string; type: string; size: number }[]): Promise<{ sessions?: string[]; error?: string }> {
  await requireRole("officer");
  if (!files.length || files.length > 20) return { error: "Choose 1 to 20 files." };
  if (files.some((f) => !(f.size > 0) || f.size > 500 * 1024 * 1024)) return { error: "Each file must be under 500 MB." };
  if (!(await getDocsConnection())) return { error: "Google Drive is not connected yet." };
  const origin = (await headers()).get("origin");
  if (!origin) return { error: "Please reload the page and try again." };
  try {
    const folder = await paymentFolder(paymentOrder);
    const sessions = await Promise.all(files.map((f) => startDocsUpload({ parentId: folder, name: safeName(f.name), mimeType: f.type || "application/octet-stream", size: f.size, origin })));
    return { sessions };
  } catch (e) {
    return { error: e instanceof DocsError ? e.message : "Could not reach Google Drive - please try again." };
  }
}

/** Officers: records the uploaded evidence (each file checked in Drive: it must be in the payment order's folder). */
export async function registerPaymentFiles(paymentOrder: string, driveIds: string[]): Promise<{ files?: PaymentFile[]; error?: string }> {
  const officer = await requireRole("officer");
  const admin = createAdminClient();
  const { data: po } = await admin.from("self_audit_payment_orders").select("drive_folder_id").eq("payment_order", paymentOrder).maybeSingle();
  if (!po?.drive_folder_id) return { error: "The payment's Drive folder is missing." };
  try {
    const infos = await Promise.all(driveIds.slice(0, 20).map((id) => driveFileInfo(id)));
    const rows = infos
      .filter((f): f is NonNullable<typeof f> => !!f && f.parents.includes(po.drive_folder_id!))
      .map((f) => ({ payment_order: paymentOrder, drive_file_id: f.id, file_name: f.name.slice(0, 300), mime_type: f.mimeType, size_bytes: f.size, uploaded_by: officer.id, uploaded_by_name: officer.full_name ?? officer.email }));
    if (!rows.length) return { files: [] };
    const { data, error } = await admin.from("self_audit_payment_files").insert(rows).select("id, drive_file_id, file_name, size_bytes, created_at, uploaded_by_name");
    if (error) return { error: error.message };
    return { files: (data ?? []).map((f) => ({ id: f.id, driveId: f.drive_file_id, name: f.file_name, size: Number(f.size_bytes), at: f.created_at, by: f.uploaded_by_name })) };
  } catch (e) {
    return { error: e instanceof DocsError ? e.message : "Could not reach Google Drive." };
  }
}

/** Officers: removes an evidence file (it goes to the Drive trash). */
export async function removePaymentFile(fileId: string): Promise<{ error?: string }> {
  await requireRole("officer");
  const admin = createAdminClient();
  const { data: f } = await admin.from("self_audit_payment_files").select("drive_file_id").eq("id", fileId).maybeSingle();
  if (!f) return { error: "File not found." };
  try {
    await trashDriveFile(f.drive_file_id);
  } catch (e) {
    return { error: e instanceof DocsError ? e.message : "Could not reach Google Drive." };
  }
  await admin.from("self_audit_payment_files").delete().eq("id", fileId);
  return {};
}

export type PaymentListRow = { paymentOrder: string; creationDate: string | null; totalVat: number; totalNoVat: number | null; currency: string; status: string | null };

/** Officers: SAIC's Payment List export - new payment orders are added (pending), known ones get the latest amounts. */
export async function importPaymentList(rows: PaymentListRow[]): Promise<{ added?: number; updated?: number; error?: string }> {
  await requireRole("officer");
  const clean = rows.filter((r) => /^[A-Z0-9-]{6,40}$/i.test(r.paymentOrder) && Number.isFinite(r.totalVat)).slice(0, 500);
  if (!clean.length) return { error: "No payment orders found in the file (columns: Payment Order, Total Payment Amount(VAT), Creation Date)." };
  const admin = createAdminClient();
  const { data: known } = await admin.from("self_audit_payment_orders").select("payment_order").in("payment_order", clean.map((r) => r.paymentOrder));
  const knownSet = new Set((known ?? []).map((k) => k.payment_order));
  const { error } = await admin.from("self_audit_payment_orders").upsert(
    clean.map((r) => ({
      payment_order: r.paymentOrder,
      creation_date: r.creationDate,
      total_vat: r.totalVat,
      total_novat: r.totalNoVat,
      currency: r.currency || "USD",
      saic_status: r.status,
      imported_at: new Date().toISOString(),
    })),
    { onConflict: "payment_order" }
  );
  if (error) return { error: error.message };
  return { added: clean.filter((r) => !knownSet.has(r.paymentOrder)).length, updated: clean.filter((r) => knownSet.has(r.paymentOrder)).length };
}
