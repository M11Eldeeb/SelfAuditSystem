import "server-only";
import type { CurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

export type TechClaimStatus = Database["public"]["Tables"]["self_audit_tech_claims"]["Row"]["status"];

export type TechClaimSummary = {
  id: string;
  claimNo: string;
  branch: string;
  technician: string;
  vin: string;
  workOrder: string;
  endOfRepair: string | null;
  status: TechClaimStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  files: number;
  timesSubmitted: number;
  createdAt: string;
};

export type TechClaimFile = { id: string; driveId: string; name: string; mimeType: string; size: number; createdAt: string };
export type TechClaimEvent = { id: string; kind: string; body: string | null; author: string | null; at: string };
export type TechClaimDetail = TechClaimSummary & {
  branchId: string;
  technicianId: string | null;
  notes: string | null;
  reviewComment: string | null;
  driveFolderId: string | null;
  fileList: TechClaimFile[];
  events: TechClaimEvent[];
};

const PAGE = 300;

/** Who may see which claims: a technician his own, a branch admin (or service manager) his branch, an officer all. */
function scope<T extends { eq: (c: string, v: string) => T }>(q: T, user: CurrentUser): T {
  const none = "00000000-0000-0000-0000-000000000000";
  if (user.role === "officer" || user.view_all) return q;
  if (user.role === "technician") return q.eq("technician_id", user.id);
  if (user.role === "branch_admin" || user.role === "service_manager") return q.eq("branch_id", user.branch_id ?? none);
  return q.eq("id", none);
}

export async function listTechClaims(user: CurrentUser, opts: { status?: string; branchId?: string; q?: string } = {}): Promise<TechClaimSummary[]> {
  const admin = createAdminClient();
  let q = scope(
    admin
      .from("self_audit_tech_claims")
      .select("id, claim_no, branch_id, technician_name, vin, work_order, end_of_repair, status, submitted_at, reviewed_at, reviewed_by_name, times_submitted, created_at"),
    user
  );
  if (opts.status && opts.status !== "all") q = q.eq("status", opts.status as TechClaimStatus);
  // A technician's drafts are his own until he submits them.
  else if (user.role !== "technician") q = q.neq("status", "uploading");
  if (opts.branchId) q = q.eq("branch_id", opts.branchId);
  const term = opts.q?.trim().replace(/[%,()]/g, "");
  if (term) q = q.or(`vin.ilike.%${term}%,work_order.ilike.%${term}%,claim_no.ilike.%${term}%,technician_name.ilike.%${term}%`);
  // Admin's queue: oldest waiting first; everything else newest first.
  const waiting = opts.status === "submitted";
  const [{ data: rows }, { data: branches }] = await Promise.all([
    q.order(waiting ? "submitted_at" : "created_at", { ascending: waiting }).limit(PAGE),
    admin.from("self_audit_branches").select("id, name"),
  ]);
  const ids = (rows ?? []).map((r) => r.id);
  const { data: files } = ids.length ? await admin.from("self_audit_tech_claim_files").select("claim_id").in("claim_id", ids) : { data: [] as { claim_id: string }[] };
  const fileCount = new Map<string, number>();
  for (const f of files ?? []) fileCount.set(f.claim_id, (fileCount.get(f.claim_id) ?? 0) + 1);
  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));
  return (rows ?? []).map((r) => ({
    id: r.id,
    claimNo: r.claim_no,
    branch: branchName.get(r.branch_id) ?? "",
    technician: r.technician_name,
    vin: r.vin ?? "",
    workOrder: r.work_order,
    endOfRepair: r.end_of_repair,
    status: r.status,
    submittedAt: r.submitted_at,
    reviewedAt: r.reviewed_at,
    reviewedBy: r.reviewed_by_name,
    files: fileCount.get(r.id) ?? 0,
    timesSubmitted: r.times_submitted,
    createdAt: r.created_at,
  }));
}

/** Counts per status for the user's scope (the page's tabs). */
export async function countTechClaims(user: CurrentUser, branchId?: string): Promise<Record<TechClaimStatus, number>> {
  const admin = createAdminClient();
  const statuses: TechClaimStatus[] = ["uploading", "submitted", "returned", "approved", "rejected"];
  const counts = await Promise.all(
    statuses.map(async (s) => {
      let q = scope(admin.from("self_audit_tech_claims").select("id", { count: "exact", head: true }), user).eq("status", s);
      if (branchId) q = q.eq("branch_id", branchId);
      const { count } = await q;
      return [s, count ?? 0] as const;
    })
  );
  return Object.fromEntries(counts) as Record<TechClaimStatus, number>;
}

/** Claims waiting for this branch admin (the nav badge). */
export async function techClaimsWaiting(user: CurrentUser): Promise<number> {
  if (user.role !== "branch_admin" || !user.branch_id) return 0;
  const { count } = await createAdminClient().from("self_audit_tech_claims").select("id", { count: "exact", head: true }).eq("branch_id", user.branch_id).eq("status", "submitted");
  return count ?? 0;
}

export async function getTechClaim(user: CurrentUser, id: string): Promise<TechClaimDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const admin = createAdminClient();
  const { data: c } = await scope(admin.from("self_audit_tech_claims").select("*"), user).eq("id", id).maybeSingle();
  if (!c) return null;
  const [{ data: files }, { data: events }, { data: branch }] = await Promise.all([
    admin.from("self_audit_tech_claim_files").select("id, drive_file_id, file_name, mime_type, size_bytes, created_at").eq("claim_id", id).order("created_at"),
    admin.from("self_audit_tech_claim_events").select("id, kind, body, author_name, created_at").eq("claim_id", id).order("created_at"),
    admin.from("self_audit_branches").select("name").eq("id", c.branch_id).maybeSingle(),
  ]);
  return {
    id: c.id,
    claimNo: c.claim_no,
    branch: branch?.name ?? "",
    branchId: c.branch_id,
    technician: c.technician_name,
    technicianId: c.technician_id,
    vin: c.vin ?? "",
    workOrder: c.work_order,
    endOfRepair: c.end_of_repair,
    status: c.status,
    submittedAt: c.submitted_at,
    reviewedAt: c.reviewed_at,
    reviewedBy: c.reviewed_by_name,
    files: files?.length ?? 0,
    timesSubmitted: c.times_submitted,
    createdAt: c.created_at,
    notes: c.notes,
    reviewComment: c.review_comment,
    driveFolderId: c.drive_folder_id,
    fileList: (files ?? []).map((f) => ({ id: f.id, driveId: f.drive_file_id, name: f.file_name, mimeType: f.mime_type, size: Number(f.size_bytes), createdAt: f.created_at })),
    events: (events ?? []).map((e) => ({ id: e.id, kind: e.kind, body: e.body, author: e.author_name, at: e.created_at })),
  };
}

/** May this user open the file (the file proxy)? */
export async function techClaimFileFor(user: CurrentUser, fileRowId: string): Promise<{ driveId: string; name: string; mimeType: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(fileRowId)) return null;
  const admin = createAdminClient();
  const { data: f } = await admin.from("self_audit_tech_claim_files").select("claim_id, drive_file_id, file_name, mime_type").eq("id", fileRowId).maybeSingle();
  if (!f) return null;
  const { data: c } = await scope(admin.from("self_audit_tech_claims").select("id"), user).eq("id", f.claim_id).maybeSingle();
  return c ? { driveId: f.drive_file_id, name: f.file_name, mimeType: f.mime_type } : null;
}
