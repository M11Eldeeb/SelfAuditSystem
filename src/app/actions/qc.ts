"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";
import { DocsError, getDocsConnection, startDocsUpload } from "@/lib/documents/drive-docs";
import { driveFileInfo, ensureWipSubFolder, moveDriveFile, trashDriveFile } from "@/lib/tech-claims/drive";
import { cleanChecklist, unanswered, type Checklist } from "@/lib/qc/checklist";
import { QC_MAX_FILES, QC_MAX_FILE_BYTES, QC_MODEL_BY_CODE, QC_PURPOSE_GROUPS, QC_REPAIR_TYPES, QC_SERVICE_ADVISORS, QC_TEAM_LEADERS, modelFromText, type QcTechnician } from "@/lib/qc/constants";

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

/** "12345", "HER-12345" or "her 12345" -> "HER-12345" (the branch code in front, as on the technician claims). A WIP number has 5 digits. */
function normalizeWip(input: string, code: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (!/^\d{5}$/.test(digits)) return null;
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
  const [{ data: techs }, { data: extra }] = await Promise.all([
    admin.from("self_audit_users").select("id, full_name, email, employee_no").eq("role", "technician").eq("branch_id", branch.id).order("full_name"),
    admin.from("self_audit_qc_extra_technicians").select("name").eq("branch_id", branch.id).order("name"),
  ]);
  const accounts: QcTechnician[] = (techs ?? []).map((t) => ({ id: t.id, name: `${t.full_name ?? t.email}${t.employee_no ? ` - ${t.employee_no}` : ""}` }));
  const taken = new Set(accounts.map((t) => t.name.toLowerCase()));
  const added: QcTechnician[] = (extra ?? []).filter((e) => !taken.has(e.name.toLowerCase())).map((e) => ({ id: null, name: e.name }));
  // The model names (MG RX5, not the batch code AS22). A fixed list: reading the codes from the claims batches took
  // seconds on every page.
  const names = [...new Set(Object.values(QC_MODEL_BY_CODE))].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  return { technicians: [...accounts, ...added], models: names, teamLeaders: QC_TEAM_LEADERS, advisors: QC_SERVICE_ADVISORS, branchCode: branch.code ?? "" };
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

export type QcWipInfo = { wip: string; vin: string | null; model: string | null; modelName: string | null; mileage: number | null; advisor: string | null; registration: string | null; earlier: { id: string; qcNo: string; status: string; purpose: string; attempts: number; createdAt: string }[] };

/** What the Open WIPs report and earlier QCs know about this WIP (to fill the form in). */
export async function lookupQcWip(input: string): Promise<{ info?: QcWipInfo; error?: string }> {
  const { branch } = await controller();
  const wip = normalizeWip(input, branch.code ?? "");
  if (!wip) return { error: "A WIP number has 5 digits." };
  const digits = wip.replace(/\D/g, "");
  const admin = createAdminClient();
  const [{ data: open }, { data: earlier }] = await Promise.all([
    admin.from("self_audit_open_wips").select("vin, model, mileage, operator, registration").eq("branch_id", branch.id).eq("wip_no", digits).limit(1).maybeSingle(),
    admin.from("self_audit_qc_checks").select("id, qc_no, status, purpose, attempts, created_at").eq("branch_id", branch.id).eq("wip_no", wip).order("created_at", { ascending: false }),
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
      vin: cleanVin(open?.vin),
      model: open?.model ?? null,
      modelName: modelFromText(open?.model),
      mileage: Number.isFinite(mileage) && mileage > 0 ? mileage : null,
      advisor,
      registration: open?.registration ?? null,
      earlier: (earlier ?? []).map((e) => ({ id: e.id, qcNo: e.qc_no, status: e.status, purpose: e.purpose, attempts: e.attempts, createdAt: e.created_at })),
    },
  };
}

const cleanVin = (v: string | null | undefined) => {
  const s = (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s || null;
};

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

/** "Closed" needs the database change (migration 0174): until then a friendly message instead of the database's. */
const notYet = (message: string | undefined) => (message && /check constraint/i.test(message) ? "This choice is not available yet - the database needs an update (ask the warranty officer)." : message);

/** Pass closes the case (passed); Closed closes it without a pass (justified); Fail keeps it open for a retest. */
const STATUS_OF = { pass: "passed", fail: "failed", close: "closed" } as const;

export type QcResultInput = { result: "pass" | "fail" | "close"; comment: string; finalOdometer: string; technicians: QcTechnician[]; driveFileIds: string[]; checklist?: unknown };

/** The inspection sheet of the repair type, every item answered (null when the repair type has no sheet). */
function checkedSheet(raw: unknown, repairType: string | null): { sheet: Checklist | null } | { error: string } {
  const sheet = cleanChecklist(raw, repairType ?? "");
  if (!sheet) return { sheet: null };
  const left = unanswered(sheet);
  if (left.length) return { error: `Answer every item of the inspection sheet (${left.length} left: ${left.slice(0, 3).join(", ")}${left.length > 3 ? "…" : ""}).` };
  return { sheet };
}

type TestInsert = Database["public"]["Tables"]["self_audit_qc_tests"]["Insert"];

/** Saves a test with its inspection sheet - without the sheet until the database has its column (migration 0175). */
async function insertTest(row: TestInsert, sheet: Checklist | null) {
  const admin = createAdminClient();
  const first = await admin.from("self_audit_qc_tests").insert({ ...row, ...(sheet ? { checklist: sheet } : {}) }).select("id").single();
  if (first.error && sheet && /checklist/i.test(first.error.message)) return admin.from("self_audit_qc_tests").insert(row).select("id").single();
  return first;
}
export type QcNewInput = QcResultInput & {
  wip: string;
  /** WIP numbers files were uploaded under before the WIP was corrected: those files move to the final WIP's folder. */
  uploadWips?: string[];
  vin: string;
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
  if (input.result !== "pass" && input.result !== "fail" && input.result !== "close") return { error: "Choose Pass, Fail or Close as Fail." };
  const comment = input.comment.trim().slice(0, 4000) || null;
  if (input.result === "fail" && !comment) return { error: "Write why the vehicle failed." };
  if (input.result === "close" && !comment) return { error: "Write why the case is closed as failed." };
  const finalOdometer = num(input.finalOdometer);
  if (finalOdometer == null) return { error: "Enter the current odometer." };
  if (finalOdometer != null && (finalOdometer > 3_000_000 || (odometerIn != null && finalOdometer < odometerIn))) return { error: "The current odometer must not be lower than the odometer in." };
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
  return { result: input.result, comment, finalOdometer, technicians };
}

/** Quality controller: records a QC (its first test) with the files attached. */
export async function submitQc(input: QcNewInput): Promise<{ id?: string; error?: string }> {
  try {
    const { user, branch, name } = await controller();
    const wip = normalizeWip(input.wip, branch.code ?? "");
    if (!wip) return { error: "Enter the WIP number (5 digits)." };
    const odometerIn = num(input.odometerIn);
    if (odometerIn == null || odometerIn > 3_000_000) return { error: "Enter the odometer in." };
    if (!QC_PURPOSE_GROUPS.some((p) => p.key === input.purpose)) return { error: "Choose the purpose of the QC test." };
    if (!QC_REPAIR_TYPES.some((p) => p.key === input.repairType)) return { error: "Choose the repair type." };
    const model = input.model.trim().slice(0, 60);
    if (!model) return { error: "Choose the vehicle model." };
    const teamLeader = input.teamLeader.trim().slice(0, 120) || null;
    const serviceAdvisor = input.serviceAdvisor.trim().slice(0, 120) || null;
    if (!teamLeader) return { error: "Choose the team leader." };
    if (!serviceAdvisor) return { error: "Choose the service advisor." };
    const r = await cleanResult(input, branch.id, odometerIn);
    if ("error" in r) return { error: r.error };
    const sheetCheck = checkedSheet(input.checklist, input.repairType);
    if ("error" in sheetCheck) return { error: sheetCheck.error };

    const folder = await qcFolder(branch, wip);
    const files = await verifiedFiles(folder, input.driveFileIds);
    // Files uploaded while another WIP number was typed: found in that WIP's QC folder and moved to this one.
    for (const other of [...new Set((input.uploadWips ?? []).map((w) => normalizeWip(w, branch.code ?? "")))]) {
      if (!other || other === wip) continue;
      const { data: known } = await createAdminClient().from("self_audit_drive_folders").select("drive_id").eq("key", qcFolderKey(branch.id, other)).maybeSingle();
      if (!known) continue;
      const stray = await verifiedFiles(known.drive_id, input.driveFileIds.filter((id) => !files.some((f) => f.id === id)));
      for (const f of stray) {
        await moveDriveFile(f.id, known.drive_id, folder);
        files.push(f);
      }
    }
    const now = new Date().toISOString();
    const admin = createAdminClient();
    const vin = input.vin.toUpperCase().replace(/\s+/g, "").slice(0, 60);
    const row: Database["public"]["Tables"]["self_audit_qc_checks"]["Insert"] = {
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
        status: STATUS_OF[r.result],
        attempts: 1,
        final_odometer: r.finalOdometer,
        passed_at: r.result === "pass" ? now : null,
        closed_at: r.result === "fail" ? null : now,
        drive_folder_id: folder,
        controller_id: user.id,
        controller_name: name,
    };
    let { data: check, error } = await admin
      .from("self_audit_qc_checks")
      .insert({ ...row, ...(vin ? { vin } : {}) })
      .select("id")
      .single();
    // Until the "closed" database change (migration 0174) is in, the QC is saved without its closing time.
    if (error && /closed_at/i.test(error.message)) {
      const { closed_at: _closedAt, ...older } = row;
      void _closedAt;
      ({ data: check, error } = await admin.from("self_audit_qc_checks").insert({ ...older, ...(vin ? { vin } : {}) }).select("id").single());
    }
    if (error || !check) return { error: notYet(error?.message) ?? "Could not save the QC." };
    const { data: test, error: testError } = await insertTest(
      { check_id: check.id, attempt_no: 1, result: r.result, comment: r.comment, technicians: r.technicians, final_odometer: r.finalOdometer, tested_by: user.id, tested_by_name: name },
      sheetCheck.sheet
    );
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
    if (check.status !== "failed") return { error: "This case is closed already." };
    const r = await cleanResult(input, branch.id, check.odometer_in);
    if ("error" in r) return { error: r.error };
    const sheetCheck = checkedSheet(input.checklist, check.repair_type);
    if ("error" in sheetCheck) return { error: sheetCheck.error };
    const admin = createAdminClient();
    const attempt = check.attempts + 1;
    const { data: test, error } = await insertTest(
      { check_id: check.id, attempt_no: attempt, result: r.result, comment: r.comment, technicians: r.technicians, final_odometer: r.finalOdometer, tested_by: user.id, tested_by_name: name },
      sheetCheck.sheet
    );
    if (error || !test) return { error: error?.code === "23505" ? "Someone tested this vehicle just now - reload the page." : (notYet(error?.message) ?? "Could not save the test.") };
    const now = new Date().toISOString();
    const update = { attempts: attempt, status: STATUS_OF[r.result], final_odometer: r.finalOdometer, passed_at: r.result === "pass" ? now : null, updated_at: now };
    const { error: updateError } = await admin.from("self_audit_qc_checks").update({ ...update, closed_at: r.result === "fail" ? null : now }).eq("id", check.id);
    if (updateError) await admin.from("self_audit_qc_checks").update(update).eq("id", check.id);
    const folder = check.drive_folder_id ?? (await qcFolder(branch, check.wip_no));
    const files = await verifiedFiles(folder, input.driveFileIds);
    if (files.length) await admin.from("self_audit_qc_files").insert(files.map((f) => ({ check_id: check.id, test_id: test.id, drive_file_id: f.id, file_name: f.name.slice(0, 300), mime_type: f.mimeType, size_bytes: f.size, uploaded_by: user.id })));
    revalidateAll();
    return {};
  } catch (e) {
    return { error: driveError(e) };
  }
}
