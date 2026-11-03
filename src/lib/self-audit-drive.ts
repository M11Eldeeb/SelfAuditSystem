import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { docsFetch, getDocsConnection } from "@/lib/documents/drive-docs";
import { ensureFolder } from "@/lib/tech-claims/drive";

/**
 * Self audit documents live in Google Drive (documents' Google account), not in Supabase:
 *   My Drive / Self Audit Documents / <YYYY-MM> / <Branch> / <Claim - work order> / <Job Card (front side)>.jpg
 *   My Drive / Self Audit Documents / <YYYY-MM> / <Branch> / Branch operations / <photo>.jpg
 * The browser uploads straight to Drive; the photo row's storage_path is "drive:<file id>.<ext>". Files from before
 * (in Supabase Storage "audit-photos") are moved over by syncSelfAuditDocsToDrive and removed from Supabase.
 */
const BUCKET = "audit-photos";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id";

export const isDrivePath = (p: string) => p.startsWith("drive:");
/** "drive:<id>.<ext>" -> <id> */
export const driveIdOf = (p: string) => p.slice(6).replace(/\.[a-z0-9]+$/i, "");
export const drivePath = (id: string, nameOrExt: string) => `drive:${id}.${(nameOrExt.split(".").pop() || "jpg").toLowerCase()}`;
export const docFileName = (label: string, ext: string) => `${label.replace(/[\\/:*?"<>|]+/g, "_")}.${ext.toLowerCase() || "jpg"}`;

const root = () => ensureFolder("root", "Self Audit Documents", "sa:root");

async function branchFolder(cycleId: string, branchId: string): Promise<string> {
  const admin = createAdminClient();
  const [{ data: cycle }, { data: branch }] = await Promise.all([
    admin.from("self_audit_audit_cycles").select("cycle_month").eq("id", cycleId).maybeSingle(),
    admin.from("self_audit_branches").select("name").eq("id", branchId).maybeSingle(),
  ]);
  const month = await ensureFolder(await root(), cycle?.cycle_month?.slice(0, 7) ?? "No month", `sa:cycle:${cycleId}`);
  return ensureFolder(month, branch?.name ?? "Branch", `sa:cb:${cycleId}:${branchId}`);
}

/** The claim's folder (made when first needed). */
export async function claimDocsFolder(assignmentId: string): Promise<string> {
  const admin = createAdminClient();
  const { data: a } = await admin.from("self_audit_audit_assignments").select("cycle_id, branch_id, claim_id").eq("id", assignmentId).maybeSingle();
  if (!a) throw new Error("Audit claim not found.");
  const { data: c } = await admin.from("self_audit_claims").select("claim_number, work_order_no").eq("id", a.claim_id).maybeSingle();
  const name = `${c?.claim_number ?? "Claim"}${c?.work_order_no ? ` - ${c.work_order_no}` : ""}`;
  return ensureFolder(await branchFolder(a.cycle_id, a.branch_id), name, `sa:claim:${assignmentId}`);
}

/** The branch operations folder of a cycle and branch. */
export async function opsDocsFolder(cycleId: string, branchId: string): Promise<string> {
  return ensureFolder(await branchFolder(cycleId, branchId), "Branch operations", `sa:ops:${cycleId}:${branchId}`);
}

async function uploadToDrive(parentId: string, name: string, mimeType: string, bytes: ArrayBuffer): Promise<string> {
  const boundary = `sa${Math.random().toString(36).slice(2)}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parentId] })}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    bytes,
    `\r\n--${boundary}--`,
  ]);
  const res = await docsFetch(UPLOAD, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body });
  const json = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!res.ok || !json.id) throw new Error(json.error?.message ?? `Google Drive replied ${res.status}`);
  return json.id;
}

type Job = { label: string; path: string; folder: () => Promise<string>; done: (driveId: string, newPath: string) => PromiseLike<{ error: unknown }> };

/**
 * Moves documents still in Supabase Storage to Drive: copies each file, points the row at the Drive file, and
 * removes it from Supabase. Scoped to one claim / one branch-operations submission, or all (the daily job).
 */
export async function syncSelfAuditDocsToDrive(opts: { assignmentId?: string; cycleId?: string; branchId?: string; limit?: number } = {}): Promise<{ moved: number; failed: number; left: number }> {
  if (!(await getDocsConnection())) return { moved: 0, failed: 0, left: 0 };
  const admin = createAdminClient();
  const limit = opts.limit ?? 40;
  const started = Date.now();
  const onlyClaims = !!opts.assignmentId;
  const onlyOps = !opts.assignmentId && !!(opts.cycleId || opts.branchId);

  let claimQ = admin.from("self_audit_audit_photos").select("id, assignment_id, photo_type_id, storage_path").not("storage_path", "like", "drive:%").is("deleted_at", null).order("uploaded_at").limit(limit);
  if (opts.assignmentId) claimQ = claimQ.eq("assignment_id", opts.assignmentId);
  let opsQ = admin.from("self_audit_branch_operation_photos").select("cycle_id, branch_id, photo_type_id, storage_path").not("storage_path", "like", "drive:%").is("deleted_at", null).order("uploaded_at").limit(limit);
  if (opts.cycleId) opsQ = opsQ.eq("cycle_id", opts.cycleId);
  if (opts.branchId) opsQ = opsQ.eq("branch_id", opts.branchId);
  const [{ data: claimPhotos }, { data: opsPhotos }, { data: types }] = await Promise.all([
    onlyOps ? Promise.resolve({ data: [] as { id: string; assignment_id: string; photo_type_id: string; storage_path: string }[] }) : claimQ,
    onlyClaims ? Promise.resolve({ data: [] as { cycle_id: string; branch_id: string; photo_type_id: string; storage_path: string }[] }) : opsQ,
    admin.from("self_audit_audit_photo_types").select("id, label"),
  ]);
  const label = new Map((types ?? []).map((t) => [t.id, t.label]));

  const folders = new Map<string, Promise<string>>();
  const once = (key: string, make: () => Promise<string>) => {
    if (!folders.has(key)) folders.set(key, make());
    return folders.get(key)!;
  };
  const jobs: Job[] = [
    ...(claimPhotos ?? []).map((p) => ({
      label: label.get(p.photo_type_id) ?? p.photo_type_id,
      path: p.storage_path,
      folder: () => once(`c:${p.assignment_id}`, () => claimDocsFolder(p.assignment_id)),
      done: (id: string, newPath: string) => admin.from("self_audit_audit_photos").update({ storage_path: newPath, drive_file_id: id }).eq("id", p.id).eq("storage_path", p.storage_path),
    })),
    ...(opsPhotos ?? []).map((p) => ({
      label: label.get(p.photo_type_id) ?? p.photo_type_id,
      path: p.storage_path,
      folder: () => once(`o:${p.cycle_id}:${p.branch_id}`, () => opsDocsFolder(p.cycle_id, p.branch_id)),
      done: (id: string, newPath: string) =>
        admin
          .from("self_audit_branch_operation_photos")
          .update({ storage_path: newPath, drive_file_id: id })
          .eq("cycle_id", p.cycle_id)
          .eq("branch_id", p.branch_id)
          .eq("photo_type_id", p.photo_type_id)
          .eq("storage_path", p.storage_path),
    })),
  ];

  let moved = 0;
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < jobs.length && Date.now() - started < 45_000) {
      const j = jobs[next++];
      try {
        const ext = j.path.split(".").pop() ?? "jpg";
        const { data: blob, error } = await admin.storage.from(BUCKET).download(j.path);
        if (error || !blob) throw new Error(error?.message ?? "missing");
        const id = await uploadToDrive(await j.folder(), docFileName(j.label, ext), blob.type || "application/octet-stream", await blob.arrayBuffer());
        const { error: upErr } = await j.done(id, drivePath(id, ext));
        if (upErr) throw new Error("row update failed");
        await admin.storage.from(BUCKET).remove([j.path]);
        moved++;
      } catch {
        failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, worker));
  return { moved, failed, left: jobs.length - moved - failed };
}
