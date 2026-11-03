import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { docsFetch, getDocsConnection } from "@/lib/documents/drive-docs";
import { ensureFolder } from "@/lib/tech-claims/drive";

/**
 * Self audit documents are uploaded to Supabase Storage (the portal shows them from there) and a copy is saved to
 * Google Drive with the documents' Google account:
 *   My Drive / Self Audit Documents / <YYYY-MM> / <Branch> / <Claim - work order> / <Job Card (front side)>.jpg
 *   My Drive / Self Audit Documents / <YYYY-MM> / <Branch> / Branch operations / <photo>.jpg
 * Copied right after the branch saves, and by the daily job for anything missed (server to server - nothing passes
 * through the browser or Vercel's CDN).
 */
const BUCKET = "audit-photos";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id";

const fileName = (label: string, path: string) => `${label.replace(/[\\/:*?"<>|]+/g, "_")}.${path.split(".").pop()?.toLowerCase() || "jpg"}`;

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

type Job = { label: string; path: string; folder: () => Promise<string>; done: (driveId: string) => PromiseLike<unknown> };

export async function syncSelfAuditDocsToDrive(opts: { assignmentId?: string; cycleId?: string; branchId?: string; limit?: number } = {}): Promise<{ copied: number; failed: number; left: number }> {
  if (!(await getDocsConnection())) return { copied: 0, failed: 0, left: 0 };
  const admin = createAdminClient();
  const limit = opts.limit ?? 40;
  const started = Date.now();

  let claimQ = admin.from("self_audit_audit_photos").select("id, assignment_id, photo_type_id, storage_path").is("drive_file_id", null).is("deleted_at", null).order("uploaded_at").limit(limit);
  if (opts.assignmentId) claimQ = claimQ.eq("assignment_id", opts.assignmentId);
  let opsQ = admin.from("self_audit_branch_operation_photos").select("cycle_id, branch_id, photo_type_id, storage_path").is("drive_file_id", null).is("deleted_at", null).order("uploaded_at").limit(limit);
  if (opts.cycleId) opsQ = opsQ.eq("cycle_id", opts.cycleId);
  if (opts.branchId) opsQ = opsQ.eq("branch_id", opts.branchId);
  const skipOps = !!opts.assignmentId;
  const skipClaims = !opts.assignmentId && !!(opts.cycleId || opts.branchId);
  const [{ data: claimPhotos }, { data: opsPhotos }, { data: types }, { data: branches }] = await Promise.all([
    skipClaims ? Promise.resolve({ data: [] as { id: string; assignment_id: string; photo_type_id: string; storage_path: string }[] }) : claimQ,
    skipOps ? Promise.resolve({ data: [] as { cycle_id: string; branch_id: string; photo_type_id: string; storage_path: string }[] }) : opsQ,
    admin.from("self_audit_audit_photo_types").select("id, label"),
    admin.from("self_audit_branches").select("id, name"),
  ]);
  const label = new Map((types ?? []).map((t) => [t.id, t.label]));
  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));

  const assignmentIds = [...new Set((claimPhotos ?? []).map((p) => p.assignment_id))];
  const { data: assignments } = assignmentIds.length
    ? await admin.from("self_audit_audit_assignments").select("id, cycle_id, branch_id, claim_id").in("id", assignmentIds)
    : { data: [] as { id: string; cycle_id: string; branch_id: string; claim_id: string }[] };
  const claimIds = [...new Set((assignments ?? []).map((a) => a.claim_id))];
  const cycleIds = [...new Set([...(assignments ?? []).map((a) => a.cycle_id), ...(opsPhotos ?? []).map((p) => p.cycle_id)])];
  const [{ data: claims }, { data: cycles }] = await Promise.all([
    claimIds.length ? admin.from("self_audit_claims").select("id, claim_number, work_order_no").in("id", claimIds) : Promise.resolve({ data: [] as { id: string; claim_number: string; work_order_no: string | null }[] }),
    cycleIds.length ? admin.from("self_audit_audit_cycles").select("id, cycle_month").in("id", cycleIds) : Promise.resolve({ data: [] as { id: string; cycle_month: string }[] }),
  ]);
  const assignmentOf = new Map((assignments ?? []).map((a) => [a.id, a]));
  const claimOf = new Map((claims ?? []).map((c) => [c.id, c]));
  const monthOf = new Map((cycles ?? []).map((c) => [c.id, c.cycle_month.slice(0, 7)]));

  // Folders are found once per run (and remembered in self_audit_drive_folders).
  const folders = new Map<string, Promise<string>>();
  const folder = (key: string, make: () => Promise<string>) => {
    if (!folders.has(key)) folders.set(key, make());
    return folders.get(key)!;
  };
  const root = () => folder("sa:root", () => ensureFolder("root", "Self Audit Documents", "sa:root"));
  const branchFolder = (cycleId: string, branchId: string) =>
    folder(`sa:cb:${cycleId}:${branchId}`, async () => {
      const month = await folder(`sa:cycle:${cycleId}`, async () => ensureFolder(await root(), monthOf.get(cycleId) ?? "No month", `sa:cycle:${cycleId}`));
      return ensureFolder(month, branchName.get(branchId) ?? "Branch", `sa:cb:${cycleId}:${branchId}`);
    });

  const jobs: Job[] = [];
  for (const p of claimPhotos ?? []) {
    const a = assignmentOf.get(p.assignment_id);
    if (!a) continue;
    const c = claimOf.get(a.claim_id);
    const claimLabel = `${c?.claim_number ?? "Claim"}${c?.work_order_no ? ` - ${c.work_order_no}` : ""}`;
    jobs.push({
      label: label.get(p.photo_type_id) ?? p.photo_type_id,
      path: p.storage_path,
      folder: () => folder(`sa:claim:${a.id}`, async () => ensureFolder(await branchFolder(a.cycle_id, a.branch_id), claimLabel, `sa:claim:${a.id}`)),
      done: (id) => admin.from("self_audit_audit_photos").update({ drive_file_id: id }).eq("id", p.id).eq("storage_path", p.storage_path),
    });
  }
  for (const p of opsPhotos ?? []) {
    jobs.push({
      label: label.get(p.photo_type_id) ?? p.photo_type_id,
      path: p.storage_path,
      folder: () => folder(`sa:ops:${p.cycle_id}:${p.branch_id}`, async () => ensureFolder(await branchFolder(p.cycle_id, p.branch_id), "Branch operations", `sa:ops:${p.cycle_id}:${p.branch_id}`)),
      done: (id) =>
        admin.from("self_audit_branch_operation_photos").update({ drive_file_id: id }).eq("cycle_id", p.cycle_id).eq("branch_id", p.branch_id).eq("photo_type_id", p.photo_type_id).eq("storage_path", p.storage_path),
    });
  }

  let copied = 0;
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < jobs.length && Date.now() - started < 45_000) {
      const j = jobs[next++];
      try {
        const { data: blob, error } = await admin.storage.from(BUCKET).download(j.path);
        if (error || !blob) throw new Error(error?.message ?? "missing");
        const id = await uploadToDrive(await j.folder(), fileName(j.label, j.path), blob.type || "application/octet-stream", await blob.arrayBuffer());
        await j.done(id);
        copied++;
      } catch {
        failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, worker));
  return { copied, failed, left: jobs.length - copied - failed };
}
