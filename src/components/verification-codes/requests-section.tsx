import { createAdminClient } from "@/lib/supabase/admin";
import type { CurrentUser } from "@/lib/auth";
import { RequestList, type VerificationRow } from "./request-list";

/**
 * Loads verification code requests for the signed-in user (own branch for the workshop, every branch for the
 * technical team and officers - the role was checked by the page) with short-lived links to the photos.
 */
export async function VerificationRequestsSection({ user, canAnswer, openId }: { user: CurrentUser; canAnswer: boolean; openId?: string }) {
  const admin = createAdminClient();
  let query = admin
    .from("self_audit_verification_requests")
    .select("*")
    .order("status", { ascending: false }) // "open" before "closed"
    .order("created_at", { ascending: false })
    .limit(200);
  if (!canAnswer) query = query.eq("branch_id", user.branch_id ?? "00000000-0000-0000-0000-000000000000");
  const [{ data: rows }, { data: branches }] = await Promise.all([query, admin.from("self_audit_branches").select("id, name")]);
  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));

  const paths = (rows ?? []).flatMap((r) => [r.vin_photo_path, r.mileage_photo_path]).filter((p): p is string => !!p);
  const signed = paths.length ? (await admin.storage.from("verification-photos").createSignedUrls(paths, 60 * 60)).data ?? [] : [];
  const urlOf = new Map(signed.flatMap((s) => (s.path && s.signedUrl ? [[s.path, s.signedUrl] as const] : [])));

  const list: VerificationRow[] = (rows ?? []).map((r) => ({
    id: r.id,
    requestNo: r.request_no,
    branch: branchName.get(r.branch_id) ?? "",
    vin: r.vin,
    mileage: r.mileage,
    moduleName: r.module_name,
    reason: r.reason,
    status: r.status,
    code: r.code,
    createdBy: r.created_by_name,
    createdAt: r.created_at,
    closedBy: r.closed_by_name,
    closedAt: r.closed_at,
    vinPhoto: r.vin_photo_path ? (urlOf.get(r.vin_photo_path) ?? null) : null,
    mileagePhoto: r.mileage_photo_path ? (urlOf.get(r.mileage_photo_path) ?? null) : null,
  }));

  return <RequestList rows={list} canAnswer={canAnswer} showBranch={canAnswer} openId={openId} />;
}
