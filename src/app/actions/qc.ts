"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { DocsError, getDocsConnection, startDocsUpload } from "@/lib/documents/drive-docs";
import { driveFileInfo, ensureWipSubFolder, trashDriveFile } from "@/lib/tech-claims/drive";
import { QC_MAX_FILES, QC_MAX_FILE_BYTES, QC_PURPOSES, QC_REPAIR_TYPES, QC_SERVICE_ADVISORS, QC_TEAM_LEADERS, type QcTechnician } from "@/lib/qc/constants";

const PATHS = ["/qc", "/admin/quality-control", "/audit/quality-control", "/workshop/quality-control"];
const revalidateAll = () => PATHS.forEach((p) => revalidatePath(p, "layout"));

const ALLOWED = /^(image\/|video\/|application\/pdf$)/;
const safeName = (n: string) => n.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim().slice(0, 200) || "file";
const driveError = (e: unknown) => (e instanceof DocsError ? e.message : "Could not reach Google Drive - please try again.");

export type QcFileMeta = { name: string; type: string; size: number };

/** The signed-in quality controller and his branch. */
async function controller() {
  const user = await requireRole("quality_controller");
  if (!user.branch_id) throw new DocsError("Your account has no branch - tell the warranty officer.");
  const { data: branch } = await createAdminClient().from("self_audit_branches").select("id, name, code").eq("id", user.branch_id).maybeSingle();
  if (!branch) throw new DocsError("Your branch was not found.");
  return { user, branch, name: user.full_name ?? user.email };
}

/** "12345", "HER-12345" or "her 12345" -> "HER-12345" (the branch code in front, as on the technician claims). */
function normalizeWip(input: string, code: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (!digits || digits.length > 20) return null;
  return code ? `${code}-${digits}` : digits;
}

const qcFolderKey = (branchId: string, wip: string) => `qc:${branchId}:${wip}`;

async function qcFolder(branch: { id: string; name: string }, wip: string): Promise<string> {
  return ensureWipSubFolder({ branchId: branch.id, branchName: branch.name, wip, sub: `QC-${wip}`, key: qcFolderKey(branch.id, wip) });
}

function checkFile(f: QcFileMeta): string | null {
  if (!(f.size > 0)) return `"${f.name}" is empty.`;
  if (f.size > QC_MAX_FILE_BYTES) return `"${f.name}" is larger than 2 GB.`;
  if (!ALLOWED.test(f.type || "")) return `"${f.name}": only photos, videos and PDF files.`;
  return null;
}

export type QcFormOptions = { technicians: QcTechnician[]; models: string[]; teamLeaders: string[]; advisors: string[]; branchCode: string };

/** The form's lists: the branch's technicians (accounts + names added before), the batch models, team leaders, advisors. */
export async function qcFormOptions(): Promise<QcFormOptions> {
  const { branch } = await controller();
  const admin = createAdminClient();
  const [{ data: techs }, { data: extra }, { data: models }] = await Promise.all([
    admin.from("self_audit_users").select("id, full_name, email, employee_no").eq("role", "technician").eq("branch_id", branch.id).order("full_name"),
    admin.from("self_audit_qc_extra_technicians").select("name").eq("branch_id", branch.id).order("name"),
    admin.rpc("qc_vehicle_models"),
  ]);
  const accounts: QcTechnician[] = (techs ?? []).map((t) => ({ id: t.id, name: `${t.full_name ?? t.email}${t.employee_no ? ` - ${t.employee_no}` : ""}` }));
  const taken = new Set(accounts.map((t) => t.name.toLowerCase()));
  const added: QcTechnician[] = (extra ?? []).filter((e) => !taken.has(e.name.toLowerCase())).map((e) => ({ id: null, name: e.name }));
  return { technicians: [...accounts, ...added], models: (models ?? []).map(String), teamLeaders: QC_TEAM_LEADERS, advisors: QC_SERVICE_ADVISORS, branchCode: branch.code ?? "" };
}

/** Quality controller: a technician without an account, kept for his branch's next QCs. */
export async function addQcTechnician(name: string): Promise<{ technician?: QcTechnician; error?: string }> {
  const { branch } = await controller();
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 120);
  if (clean.length < 2) return { error: "Write the technician's name." };
  const admin = createAdminClient();
  const { data: had } = await admin.from("self_audit_qc_extra_technicians").select("name").eq("branch_id", branch.id).ilike("name", clean).maybeSingle();
  if (!had) {
    const { error } = await admin.from("self_audit_qc_extra_technicians").insert({ branch_id: branch.id, name: clean });
    if (error) return { error: error.message };
  }
  return { technician: { id: null, name: had?.name ?? clean } };
}

export type QcWipInfo = { wip: string; model: string | null; mileage: number | null; advisor: string | null; registration: string | null; earlier: { id: string; qcNo: string; status: string }[] };

/** What the Open WIPs report and earlier QCs know about this WIP (to fill the form in). */
export async function lookupQcWip(input: string): Promise<{ info?: QcWipInfo; error?: string }> {
  const { branch } = await controller();
  const wip = normalizeWip(input, branch.code ?? "");
  if (!wip) return { error: "Enter the WIP number." };
  const digits = wip.replace(/\D/g, "");
  const admin = createAdminClient();
  const [{ data: open }, { data: earlier }] = await Promise.all([
    admin.from("self_audit_open_wips").select("model, mileage, operator, registration").eq("branch_id", branch.id).eq("wip_no", digits).limit(1).maybeSingle(),
    admin.from("self_audit_qc_checks").select("id, qc_no, status").eq("branch_id", branch.id).eq("wip_no", wip).order("created_at", { ascending: false }),
  ]);
  const mileage = open?.mileage ? Number(String(open.mileage).replace(/\D/g, "")) : NaN;
  // The report writes the advisor's name its own way ("MoayedAlothman"): match on letters only.
  const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const op = open?.operator ? letters(open.operator) : "";
  // Same first name and the surname's first 4 letters ("Amr Yosry Elsherbini" = "Amr Elsharbini").
  const advisor = op
    ? (QC_SERVICE_ADVISORS.find((a) => {
        const parts = a.split(/\s+/).map(letters);
        return op.startsWith(parts[0]) && op.includes(parts[parts.length - 1].slice(0, 4));
      }) ?? null)
    : null;
  return {
    info: {
      wip,
      model: open?.model ?? null,
      mileage: Number.isFinite(mileage) && mileage > 0 ? mileage : null,
      advisor,
      registration: open?.registration ?? null,
      earlier: (earlier ?? []).map((e) => ({ id: e.id, qcNo: e.qc_no, status: e.status })),
    },
  };
}

/** A failed QC of the controller's branch (to test again). */
async function failedCheck(checkId: string, branchId: string) {
  const { data } = await createAdminClient().from("self_audit_qc_checks").select("*").eq("id", checkId).maybeSingle();
  if (!data || data.branch_id !== branchId) return null;
  return data;
}

/**
 * One upload session for a file added to the form, straight into Warranty Documents / <Branch> / <WIP> / QC-<WIP>.
 * A new QC names its WIP (`wip`); a test again names the QC (`checkId`).
 */
export async function prepareQcUpload(target: { wip?: string; checkId?: string }, file: QcFileMeta): Promise<{ session?: string; error?: string }> {
  const bad = checkFile(file);
  if (bad) return { error: bad };
  try {
    const { branch } = await controller();
    if (!(await getDocsConnection())) return { error: "Google Drive is not connected yet - tell the warranty officer." };
    let wip: string | null;
    if (target.checkId) {
      const c = await failedCheck(target.checkId, branch.id);
      if (!c) return { error: "QC not found." };
      wip = c.wip_no;
    } else wip = normalizeWip(target.wip ?? "", branch.code ?? "");
    if (!wip) return { error: "Enter the WIP number before attaching files." };
    const folder = await qcFolder(branch, wip);
    const origin = (await headers()).get("origin");
    if (!origin) return { error: "Please reload the page and try again." };
    return { session: await startDocsUpload({ parentId: folder, name: safeName(file.name), mimeType: file.type, size: file.size, origin }) };
  } catch (e) {
    return { error: driveError(e) };
  }
}

/** A file removed from the form before submitting goes to the Drive trash (only if it is in the QC folder). */
export async function discardQcUpload(target: { wip?: string; checkId?: string }, driveFileId: string): Promise<{ error?: string }> {
  try {
    const { branch } = await controller();
    let wip: string | null = null;
    if (target.checkId) wip = (await failedCheck(target.checkId, branch.id))?.wip_no ?? null;
    else wip = normalizeWip(target.wip ?? "", branch.code ?? "");
    if (!wip) return {};
    const { data: folder } = await createAdminClient().from("self_audit_drive_folders").select("drive_id").eq("key", qcFolderKey(branch.id, wip)).maybeSingle();
    const info = await driveFileInfo(driveFileId);
    if (folder && info && info.parents.includes(folder.drive_id)) await trashDriveFile(driveFileId);
    return {};
  } catch (e) {
    return { error: driveError(e) };
  }
}

/** The uploaded files that really are in this WIP's QC folder (checked with Google). */
async function verifiedFiles(folderId: string, ids: string[]) {
  const infos = await Promise.all([...new Set(ids)].slice(0, QC_MAX_FILES).map((id) => driveFileInfo(id)));
  return infos.filter((f): f is NonNullable<typeof f> => !!f && !f.trashed && f.parents.includes(folderId) && ALLOWED.test(f.mimeType) && f.size <= QC_MAX_FILE_BYTES);
}

export type QcResultInput = { result: "pass" | "fail"; comment: string; finalOdometer: string; technicians: QcTechnician[]; driveFileIds: string[] };
export type QcNewInput = QcResultInput & {
  wip: string;
  odometerIn: string;
  purpose: string;
  model: string;
  teamLeader: string;
  serviceAdvisor: string;
  replacedParts: string;
  defectDescription: string;
  repairType: string;
};

const num = (s: string) => {
  const n = Number(String(s).replace(/[^\d]/g, ""));
  return String(s).trim() && Number.isFinite(n) ? n : null;
};

/** The pass / fail part (shared by a new QC and a test again). */
async function cleanResult(input: QcResultInput, branchId: string, odometerIn: number | null) {
  if (input.result !== "pass" && input.result !== "fail") return { error: "Choose Pass or Fail." };
  const comment = input.comment.trim().slice(0, 4000) || null;
  if (input.result === "fail" && !comment) return { error: "Write why the vehicle failed." };
  const finalOdometer = num(input.finalOdometer);
  if (input.result === "pass" && finalOdometer == null) return { error: "Enter the final odometer." };
  if (finalOdometer != null && (finalOdometer > 3_000_000 || (odometerIn != null && finalOdometer < odometerIn))) return { error: "The final odometer must not be lower than the odometer in." };
  // Technicians: accounts of this branch (checked) or names typed in.
  const ids = input.technicians.map((t) => t.id).filter((x): x is string => !!x);
  const { data: accounts } = ids.length ? await createAdminClient().from("self_audit_users").select("id").in("id", ids).eq("role", "technician").eq("branch_id", branchId) : { data: [] };
  const ok = new Set((accounts ?? []).map((a) => a.id));
  const seen = new Set<string>();
  const technicians: QcTechnician[] = [];
  for (const t of input.technicians.slice(0, 10)) {
    const name = String(t.name ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    technicians.push({ id: t.id && ok.has(t.id) ? t.id : null, name });
  }
  if (!technicians.length) return { error: "Choose the technician." };
  return { result: input.result, comment, finalOdometer: input.result === "pass" ? finalOdometer : null, technicians };
}

/** Quality controller: records a QC (its first test) with the files attached. */
export async function submitQc(input: QcNewInput): Promise<{ id?: string; error?: string }> {
  try {
    const { user, branch, name } = await controller();
    const wip = normalizeWip(input.wip, branch.code ?? "");
    if (!wip) return { error: "Enter the WIP number." };
    const odometerIn = num(input.odometerIn);
    if (odometerIn == null || odometerIn > 3_000_000) return { error: "Enter the odometer in." };
    if (!QC_PURPOSES.some((p) => p.key === input.purpose)) return { error: "Choose the purpose of the QC test." };
    if (!QC_REPAIR_TYPES.some((p) => p.key === input.repairType)) return { error: "Choose the repair type." };
    const model = input.model.trim().slice(0, 60);
    if (!model) return { error: "Choose the vehicle model." };
    const teamLeader = input.teamLeader.trim().slice(0, 120) || null;
    const serviceAdvisor = input.serviceAdvisor.trim().slice(0, 120) || null;
    if (!teamLeader) return { error: "Choose the team leader." };
    if (!serviceAdvisor) return { error: "Choose the service advisor." };
    const r = await cleanResult(input, branch.id, odometerIn);
    if ("error" in r) return { error: r.error };

    const folder = await qcFolder(branch, wip);
    const files = await verifiedFiles(folder, input.driveFileIds);
    const now = new Date().toISOString();
    const admin = createAdminClient();
    const { data: check, error } = await admin
      .from("self_audit_qc_checks")
      .insert({
        branch_id: branch.id,
        wip_no: wip,
        model,
        odometer_in: odometerIn,
        purpose: input.purpose as never,
        repair_type: input.repairType as never,
        team_leader: teamLeader,
        service_advisor: serviceAdvisor,
        replaced_parts: input.replacedParts.trim().slice(0, 4000) || null,
        defect_description: input.defectDescription.trim().slice(0, 4000) || null,
        status: r.result === "pass" ? "passed" : "failed",
        attempts: 1,
        final_odometer: r.finalOdometer,
        passed_at: r.result === "pass" ? now : null,
        drive_folder_id: folder,
        controller_id: user.id,
        controller_name: name,
      })
      .select("id")
      .single();
    if (error || !check) return { error: error?.message ?? "Could not save the QC." };
    const { data: test, error: testError } = await admin
      .from("self_audit_qc_tests")
      .insert({ check_id: check.id, attempt_no: 1, result: r.result, comment: r.comment, technicians: r.technicians, final_odometer: r.finalOdometer, tested_by: user.id, tested_by_name: name })
      .select("id")
      .single();
    if (testError || !test) return { id: check.id, error: testError?.message ?? "Could not save the test." };
    if (files.length) await admin.from("self_audit_qc_files").insert(files.map((f) => ({ check_id: check.id, test_id: test.id, drive_file_id: f.id, file_name: f.name.slice(0, 300), mime_type: f.mimeType, size_bytes: f.size, uploaded_by: user.id })));
    revalidateAll();
    return { id: check.id };
  } catch (e) {
    return { error: driveError(e) };
  }
}

/** Quality controller: tests a failed vehicle again (after the workshop read his notes) - pass, or fail again. */
export async function retestQc(checkId: string, input: QcResultInput): Promise<{ error?: string }> {
  try {
    const { user, branch, name } = await controller();
    const check = await failedCheck(checkId, branch.id);
    if (!check) return { error: "QC not found." };
    if (check.status !== "failed") return { error: "This vehicle has passed already." };
    const r = await cleanResult(input, branch.id, check.odometer_in);
    if ("error" in r) return { error: r.error };
    const admin = createAdminClient();
    const attempt = check.attempts + 1;
    const { data: test, error } = await admin
      .from("self_audit_qc_tests")
      .insert({ check_id: check.id, attempt_no: attempt, result: r.result, comment: r.comment, technicians: r.technicians, final_odometer: r.finalOdometer, tested_by: user.id, tested_by_name: name })
      .select("id")
      .single();
    if (error || !test) return { error: error?.code === "23505" ? "Someone tested this vehicle just now - reload the page." : (error?.message ?? "Could not save the test.") };
    const now = new Date().toISOString();
    await admin
      .from("self_audit_qc_checks")
      .update({ attempts: attempt, status: r.result === "pass" ? "passed" : "failed", final_odometer: r.finalOdometer, passed_at: r.result === "pass" ? now : null, updated_at: now })
      .eq("id", check.id);
    const folder = check.drive_folder_id ?? (await qcFolder(branch, check.wip_no));
    const files = await verifiedFiles(folder, input.driveFileIds);
    if (files.length) await admin.from("self_audit_qc_files").insert(files.map((f) => ({ check_id: check.id, test_id: test.id, drive_file_id: f.id, file_name: f.name.slice(0, 300), mime_type: f.mimeType, size_bytes: f.size, uploaded_by: user.id })));
    revalidateAll();
    return {};
  } catch (e) {
    return { error: driveError(e) };
  }
}
