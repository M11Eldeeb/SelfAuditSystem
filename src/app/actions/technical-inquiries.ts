"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { headers } from "next/headers";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatBytes, isAllowedFeedbackMime } from "@/lib/feedback-constants";
import { DriveError, ensureInquiryFolder, getDriveStatus, getFileMeta, renameFile, startResumableUpload, syncDriveSharing } from "@/lib/google-drive";
import { normalizeWorkOrder } from "@/lib/rejected-claims";
import { getInquiriesAccess } from "@/lib/technical-inquiries-server";
import { notifyInquiry, type InquiryEvent } from "@/lib/mail/inquiry-mails";
import { syncInquiryPdf } from "@/lib/technical-inquiry-pdf";
import { siteOrigin } from "@/lib/site-origin";
import {
  INQUIRY_DTC_MAX,
  INQUIRY_FIRST_NOTICED_MAX,
  INQUIRY_MAX_FILES,
  INQUIRY_MAX_CASE_FILES,
  INQUIRY_MAX_STEPS,
  INQUIRY_MAX_UPLOAD_BATCH,
  INQUIRY_MAX_WORK_ORDERS,
  INQUIRY_PERSON_MAX,
  INQUIRY_PLATE_MAX,
  INQUIRY_STEP_MAX,
  LOW_MILEAGE_LIMIT_KM,
  OCCURRENCE_CONDITIONS,
  isWorkshopRole,
  SUBMIT_REASONS,
  type AttachmentCategory,
  INQUIRY_MAX_FILE_BYTES,
  INQUIRY_MAX_MILEAGE,
  INQUIRY_MODEL_MAX,
  INQUIRY_SHORT_TEXT_MAX,
  INQUIRY_SOFTWARE_MAX,
  INQUIRY_TEXT_MAX,
  SYSTEMS,
  VIN_PATTERN,
  inquiryLabel,
  type InquirySystem,
} from "@/lib/technical-inquiries";

/** A file the browser has already uploaded to Google Drive. */
export type InquiryAttachmentInput = { driveFileId: string; name: string; type: string; size: number; category?: AttachmentCategory };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_CONNECTED = "Google Drive is not connected yet - ask an officer to connect it.";
const safeDriveName = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim().slice(0, 180) || "file";
const driveMessage = (e: unknown) => (e instanceof DriveError ? e.message : "Could not reach Google Drive - please try again.");

async function inquiryUser(): Promise<{ user: CurrentUser } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Please sign in again." };
  const access = await getInquiriesAccess(user);
  if (access === "locked") return { error: "Technical Inquiries is coming soon for branch admins." };
  if (access !== "full") return { error: "You do not have access to Technical Inquiries." };
  return { user };
}

function revalidateInquiries(inquiryId?: string) {
  for (const base of ["/admin/technical-inquiries", "/audit/technical-inquiries", "/technical/technical-inquiries", "/workshop/technical-inquiries"]) {
    revalidatePath(base);
    if (inquiryId) revalidatePath(`${base}/${inquiryId}`);
  }
}

/**
 * After a change on a case, once the response has gone: the case sheet in Drive is rewritten and the mail for the event
 * goes to the other side (when its switch is on). Neither can undo the change - both only log problems.
 */
function afterCaseChange(event: InquiryEvent | null, inquiryId: string, origin: string) {
  after(async () => {
    await syncInquiryPdf(inquiryId);
    if (event) await notifyInquiry(event, inquiryId, origin);
  });
}

function checkFiles(files: { name: string; type: string; size: number }[]): string | null {
  if (files.length === 0) return "Choose a file first.";
  if (files.length > INQUIRY_MAX_UPLOAD_BATCH) return `You can send at most ${INQUIRY_MAX_UPLOAD_BATCH} files at once.`;
  for (const f of files) {
    if (!isAllowedFeedbackMime(f.type)) return `"${f.name}" is not a photo, PDF or video.`;
    if (!(f.size >= 1) || f.size > INQUIRY_MAX_FILE_BYTES) return `"${f.name}" must be between 1 byte and ${formatBytes(INQUIRY_MAX_FILE_BYTES)}.`;
  }
  return null;
}

/**
 * Step 1 of attaching files: makes sure the case's Drive folder exists (Technical Inquiries / <branch> / <case>) and
 * opens one upload session per file; the browser then sends each file straight to Google. For a new inquiry pass the
 * branch and work order typed; for an existing one only its id.
 */
export async function prepareInquiryUploads(input: {
  inquiryId: string;
  branchId?: string;
  workOrder?: string;
  files: { name: string; type: string; size: number }[];
}): Promise<{ uploads?: { sessionUrl: string }[]; error?: string }> {
  const who = await inquiryUser();
  if ("error" in who) return { error: who.error };
  const { user } = who;
  if (!UUID.test(input.inquiryId)) return { error: "Something went wrong - please reload the page and try again." };
  const fileError = checkFiles(input.files);
  if (fileError) return { error: fileError };
  if (!(await getDriveStatus())) return { error: NOT_CONNECTED };

  const supabase = await createClient();
  let branchId: string;
  let label: string;
  if (input.workOrder !== undefined) {
    // A new inquiry: the branch and work order come from the form.
    if (user.role === "technical") return { error: "The technical team does not submit inquiries." };
    const candidate = isWorkshopRole(user.role) ? user.branch_id : input.branchId;
    if (!candidate || !UUID.test(candidate)) return { error: "Choose the branch first." };
    const { data: branch } = await supabase.from("self_audit_branches").select("id, code").eq("id", candidate).maybeSingle();
    if (!branch) return { error: "Branch not found." };
    const wo = normalizeWorkOrder(input.workOrder, branch.code);
    if (wo.value === undefined) return { error: `${wo.error} Enter the work order before attaching files.` };
    branchId = branch.id;
    label = `${wo.value} - new ${input.inquiryId.slice(0, 8)}`;
  } else {
    // An existing inquiry (adding a comment): read it as the caller, so access is checked.
    const { data: inquiry } = await supabase.from("self_audit_technical_inquiries").select("branch_id, work_order_no, inquiry_no, status").eq("id", input.inquiryId).maybeSingle();
    if (!inquiry) return { error: "This inquiry was not found." };
    if (inquiry.status === "closed" || inquiry.status === "cancelled") return { error: `This inquiry is ${inquiry.status}.` };
    branchId = inquiry.branch_id;
    label = `${inquiryLabel(inquiry.inquiry_no)} - ${inquiry.work_order_no}`;
  }

  const { data: branchRow } = await supabase.from("self_audit_branches").select("name").eq("id", branchId).maybeSingle();
  const origin = (await headers()).get("origin");
  if (!origin) return { error: "Something went wrong - please reload the page and try again." };

  try {
    const folder = await ensureInquiryFolder({ inquiryId: input.inquiryId, branchId, branchName: branchRow?.name ?? "Branch", label });
    const uploads = await Promise.all(
      input.files.map(async (f) => ({
        sessionUrl: await startResumableUpload({ parentId: folder, name: safeDriveName(f.name), mimeType: f.type, size: f.size, origin }),
      }))
    );
    return { uploads };
  } catch (e) {
    return { error: driveMessage(e) };
  }
}

/** Before saving: re-checks every file the browser says it uploaded against Google - it exists, sits in this case's folder and is a sane size and type. */
async function verifyAttachments(inquiryId: string, files: InquiryAttachmentInput[], maxFiles = INQUIRY_MAX_FILES) {
  if (files.length === 0) return { rows: [] as { driveFileId: string; name: string; type: string; size: number; category: AttachmentCategory }[] };
  if (files.length > maxFiles) return { error: `You can attach at most ${maxFiles} files.` };
  if (!(await getDriveStatus())) return { error: NOT_CONNECTED };
  const { data: folder } = await createAdminClient().from("self_audit_drive_folders").select("drive_id").eq("key", `inquiry:case:${inquiryId}`).maybeSingle();
  if (!folder) return { error: "The upload folder was not found - please attach the files again." };

  const unique = files.filter((f, i) => files.findIndex((g) => g.driveFileId === f.driveFileId) === i);
  const rows = [];
  try {
    const metas = await Promise.all(unique.map((f) => getFileMeta(f.driveFileId)));
    for (let i = 0; i < unique.length; i++) {
      const meta = metas[i];
      if (!meta || meta.trashed || !meta.parents.includes(folder.drive_id)) return { error: `"${unique[i].name}" did not finish uploading - please attach it again.` };
      if (!isAllowedFeedbackMime(meta.mimeType)) return { error: `"${meta.name}" is not a photo, PDF or video.` };
      if (meta.size < 1 || meta.size > INQUIRY_MAX_FILE_BYTES) return { error: `"${meta.name}" is larger than ${formatBytes(INQUIRY_MAX_FILE_BYTES)}.` };
      const category: AttachmentCategory = unique[i].category && ["concern_media", "vehicle_history", "workshop_effort"].includes(unique[i].category as string) ? (unique[i].category as AttachmentCategory) : "other";
      rows.push({ driveFileId: meta.id, name: meta.name, type: meta.mimeType, size: meta.size, category });
    }
  } catch (e) {
    return { error: driveMessage(e) };
  }
  return { rows };
}

/** One work order of a case: its steps (each with its own files) and the three documents asked for every work order. */
export type WorkOrderInput = {
  workOrder: string;
  /** What the customer complained about at that earlier visit - required for a previous work order. */
  previousConcern?: string;
  steps: { text: string; files: InquiryAttachmentInput[] }[];
  vds: InquiryAttachmentInput[];
  woPhotos: InquiryAttachmentInput[];
  agreementPhotos: InquiryAttachmentInput[];
};

export type CreateInquiryInput = {
  id: string;
  branchId?: string;
  vin: string;
  plate: string;
  model: string;
  system: string;
  /** "in_workshop" or "out": is the car still in the workshop? */
  vehicleLocation: string;
  mileage?: number | null;
  dtc?: string;
  software?: string;
  /** "permanent" or "intermittent", with the conditions it happens in (keys of OCCURRENCE_CONDITIONS; "other" needs the text in `conditions`). */
  occurrence?: string;
  conditionKeys: string[];
  conditions?: string;
  partsReplaced?: string;
  /** A phone number for the technical team to reach the person escalating (who is the submitter themselves). */
  responsiblePhone?: string;
  /** When the customer first noticed the concern (from the customer interview), and whether it follows a previous repair. */
  firstNoticed: string;
  afterRepair: string;
  repairDetails?: string;
  fault: string;
  comments?: string;
  /** The conditions for sending a case to the technical team that are met (at least one). */
  reasons: string[];
  /** The current work order first, then the previous ones of the same problem. */
  workOrders: WorkOrderInput[];
  /** The case-level files: the concern media and the vehicle history, each with its category. */
  attachments: InquiryAttachmentInput[];
};

const OCCURRENCE_KEYS = OCCURRENCE_CONDITIONS.map((c) => c.key) as string[];

/** Submits a technical inquiry. A branch admin always submits for their own branch; an officer picks the branch. */
export async function createTechnicalInquiry(input: CreateInquiryInput): Promise<{ id?: string; no?: number; error?: string }> {
  const who = await inquiryUser();
  if ("error" in who) return { error: who.error };
  const { user } = who;
  if (user.role === "technical") return { error: "The technical team does not submit inquiries." };
  if (!UUID.test(input.id)) return { error: "Something went wrong - please reload the page and try again." };

  const supabase = await createClient();
  const branchId = isWorkshopRole(user.role) ? user.branch_id : input.branchId;
  if (!branchId || !UUID.test(branchId)) return { error: "Choose the branch." };
  const { data: branch } = await supabase.from("self_audit_branches").select("id, code").eq("id", branchId).maybeSingle();
  if (!branch) return { error: "Branch not found." };

  const reasons = [...new Set(input.reasons ?? [])];
  if (reasons.length === 0) return { error: "A case can only go to the technical team when one of the conditions is met - tick at least one." };
  if (!reasons.every((r) => SUBMIT_REASONS.some((x) => x.key === r))) return { error: "Unknown condition." };

  // Work orders: the first is the current one; every other is a previous work order of the same problem.
  if (!Array.isArray(input.workOrders) || input.workOrders.length === 0) return { error: "Enter the work order number." };
  if (input.workOrders.length > INQUIRY_MAX_WORK_ORDERS) return { error: `At most ${INQUIRY_MAX_WORK_ORDERS} work orders (the current one and ${INQUIRY_MAX_WORK_ORDERS - 1} previous ones).` };
  const seenWo = new Set<string>();
  const workOrders: { value: string; input: WorkOrderInput }[] = [];
  for (const [index, w] of input.workOrders.entries()) {
    const wo = normalizeWorkOrder(w.workOrder, branch.code);
    if (wo.value === undefined) return { error: `${index === 0 ? "Work order" : `Previous work order ${index}`}: ${wo.error}` };
    if (seenWo.has(wo.value)) return { error: `The work order ${wo.value} is listed twice.` };
    seenWo.add(wo.value);
    const label = index === 0 ? `work order ${wo.value}` : `previous work order ${wo.value}`;
    if (index > 0 && !(w.previousConcern ?? "").trim()) return { error: `Write the customer previous concern of ${label}.` };
    if ((w.previousConcern ?? "").length > INQUIRY_TEXT_MAX) return { error: `The customer previous concern can be at most ${INQUIRY_TEXT_MAX} characters.` };
    const texts = w.steps.map((st) => st.text.trim());
    if (texts.length === 0 || texts.some((t) => !t)) return { error: `Write the workshop effort of ${label}, step by step (every step needs its text).` };
    if (texts.length > INQUIRY_MAX_STEPS) return { error: `At most ${INQUIRY_MAX_STEPS} steps per work order.` };
    if (texts.some((t) => t.length > INQUIRY_STEP_MAX)) return { error: `Each step can be at most ${INQUIRY_STEP_MAX} characters.` };
    if (w.vds.length === 0) return { error: `Attach the VDS report of ${label}.` };
    if (w.woPhotos.length === 0) return { error: `Attach a photo of ${label}.` };
    if (w.agreementPhotos.length === 0) return { error: `Attach a photo of the agreement of ${label}.` };
    workOrders.push({ value: wo.value, input: w });
  }
  const wo = { value: workOrders[0].value };

  const vin = input.vin.trim().toUpperCase().replace(/\s+/g, "");
  if (!VIN_PATTERN.test(vin)) return { error: "The VIN must be 17 letters and digits (no I, O or Q)." };
  const model = input.model.trim();
  if (!model) return { error: "Enter the vehicle model." };
  if (model.length > INQUIRY_MODEL_MAX) return { error: `The vehicle model can be at most ${INQUIRY_MODEL_MAX} characters.` };
  if (!(SYSTEMS as readonly string[]).includes(input.system)) return { error: "Choose the vehicle system the fault is in." };
  if (input.vehicleLocation !== "in_workshop" && input.vehicleLocation !== "out") return { error: "Say whether the car is in the workshop or out." };
  const mileage = input.mileage == null || (input.mileage as unknown) === "" ? null : Number(input.mileage);
  if (mileage === null) return { error: "Enter the mileage." };
  if (!Number.isInteger(mileage) || mileage < 0 || mileage > INQUIRY_MAX_MILEAGE) return { error: "The mileage must be a whole number of kilometres." };
  if (reasons.includes("low_mileage") && mileage >= LOW_MILEAGE_LIMIT_KM) return { error: "The low mileage condition needs a mileage below 1,000 km." };
  const plate = input.plate.trim().replace(/\s+/g, " ").toUpperCase();
  if (!plate) return { error: "Enter the plate number." };
  if (plate.length < 2 || plate.length > INQUIRY_PLATE_MAX) return { error: `The plate number must be between 2 and ${INQUIRY_PLATE_MAX} characters.` };
  // The case is escalated by the person submitting it: their name and role come from their account.
  const responsibleName = (user.full_name?.trim() || user.email).slice(0, INQUIRY_PERSON_MAX);
  const responsibleRole = ["workshop_supervisor", "team_leader", "branch_admin", "officer"].includes(user.role) ? user.role : "delegated";
  const responsiblePhone = (input.responsiblePhone ?? "").trim();
  if (responsiblePhone.length > 40) return { error: "The phone number can be at most 40 characters." };
  const firstNoticed = input.firstNoticed.trim();
  if (!firstNoticed) return { error: "Say when the customer first noticed the concern." };
  if (firstNoticed.length > INQUIRY_FIRST_NOTICED_MAX) return { error: `That answer can be at most ${INQUIRY_FIRST_NOTICED_MAX} characters.` };
  if (!["yes", "no", "unknown"].includes(input.afterRepair)) return { error: "Say whether the concern is related to a previous repair." };
  const repairDetails = (input.repairDetails ?? "").trim();
  if (input.afterRepair === "yes" && !repairDetails) return { error: "Say which previous repair it follows (what was repaired, when, work order)." };
  const dtc = (input.dtc ?? "").trim();
  const software = (input.software ?? "").trim();
  const occurrence = (input.occurrence ?? "").trim();
  const conditions = (input.conditions ?? "").trim();
  const partsReplaced = (input.partsReplaced ?? "").trim();
  if (occurrence !== "permanent" && occurrence !== "intermittent") return { error: "Say whether the concern is permanent or intermittent." };
  const conditionKeys = [...new Set(input.conditionKeys ?? [])];
  if (conditionKeys.length === 0) return { error: "Tick when the concern happens." };
  if (!conditionKeys.every((k) => OCCURRENCE_KEYS.includes(k))) return { error: "Unknown condition." };
  if (conditionKeys.includes("other") && !conditions) return { error: "Describe the other condition in which the concern happens." };
  if (dtc.length > INQUIRY_DTC_MAX) return { error: `The fault codes can be at most ${INQUIRY_DTC_MAX} characters.` };
  if (software.length > INQUIRY_SOFTWARE_MAX) return { error: `The software version can be at most ${INQUIRY_SOFTWARE_MAX} characters.` };
  if (conditions.length > INQUIRY_SHORT_TEXT_MAX || partsReplaced.length > INQUIRY_SHORT_TEXT_MAX || repairDetails.length > INQUIRY_SHORT_TEXT_MAX) return { error: `Those fields can be at most ${INQUIRY_SHORT_TEXT_MAX} characters.` };
  const fault = input.fault.trim();
  const comments = (input.comments ?? "").trim();
  if (!fault) return { error: "Describe the customer concern." };
  for (const [label, text] of [["customer concern", fault], ["comments", comments]] as const) {
    if (text.length > INQUIRY_TEXT_MAX) return { error: `The ${label} can be at most ${INQUIRY_TEXT_MAX} characters.` };
  }

  // Every file the browser says it uploaded is checked against Google once: it exists, sits in this case's folder, is a sane size and type.
  const nested = workOrders.flatMap(({ input: w }) => [...w.steps.flatMap((st) => st.files), ...w.vds, ...w.woPhotos, ...w.agreementPhotos]);
  const verified = await verifyAttachments(input.id, [...input.attachments, ...nested], INQUIRY_MAX_CASE_FILES);
  if ("error" in verified) return { error: verified.error };
  const byId = new Map(verified.rows.map((r) => [r.driveFileId, r]));
  const checked = (files: InquiryAttachmentInput[]) => files.flatMap((f) => (byId.get(f.driveFileId) ? [{ driveFileId: f.driveFileId, name: byId.get(f.driveFileId)!.name, type: byId.get(f.driveFileId)!.type, size: byId.get(f.driveFileId)!.size }] : []));
  const caseFiles = verified.rows.filter((r) => input.attachments.some((a) => a.driveFileId === r.driveFileId));
  if (!caseFiles.some((f) => f.category === "concern_media" && (f.type.startsWith("image/") || f.type.startsWith("video/")))) return { error: "Attach a photo or video that shows the customer concern." };
  if (!caseFiles.some((f) => f.category === "vehicle_history")) return { error: "Attach the full vehicle history (service / repair history)." };

  const { data: no, error } = await supabase.rpc("create_technical_inquiry", {
    p_id: input.id,
    p_branch_id: branchId,
    p_work_order: wo.value,
    p_vin: vin,
    p_plate: plate,
    p_model: model,
    p_system: input.system as InquirySystem,
    p_vehicle_location: input.vehicleLocation,
    p_mileage: mileage,
    p_dtc: dtc || null,
    p_software: software || null,
    p_occurrence: occurrence,
    p_condition_keys: conditionKeys,
    p_conditions: conditionKeys.includes("other") ? conditions : null,
    p_parts: partsReplaced || null,
    p_responsible_name: responsibleName,
    p_responsible_role: responsibleRole,
    p_responsible_phone: responsiblePhone || null,
    p_first_noticed: firstNoticed,
    p_after_repair: input.afterRepair,
    p_repair_details: repairDetails || null,
    p_fault: fault,
    p_comments: comments || null,
    p_reasons: reasons,
    p_work_orders: workOrders.map(({ value, input: w }, index) => ({
      workOrder: value,
      previousConcern: index > 0 ? (w.previousConcern ?? "").trim() : null,
      steps: w.steps.map((st) => ({ text: st.text.trim(), files: checked(st.files) })),
      vds: checked(w.vds),
      woPhotos: checked(w.woPhotos),
      agreementPhotos: checked(w.agreementPhotos),
    })),
    p_attachments: caseFiles,
  });
  if (error) {
    if (error.code === "23505") {
      // A double click or a retry after a slow save: the inquiry is already there.
      const { data: same } = await supabase.from("self_audit_technical_inquiries").select("id, inquiry_no").eq("id", input.id).maybeSingle();
      if (same) {
        revalidateInquiries(same.id);
        return { id: same.id, no: same.inquiry_no };
      }
    }
    return { error: error.message };
  }

  // After the response: the Drive folder gets its final name (TI-0007 - work order), the right people get view access,
  // the case sheet is written and the technical team is told.
  const origin = await siteOrigin();
  after(async () => {
    try {
      const { data: folder } = await createAdminClient().from("self_audit_drive_folders").select("drive_id").eq("key", `inquiry:case:${input.id}`).maybeSingle();
      if (folder) await renameFile(folder.drive_id, `${inquiryLabel(Number(no))} - ${wo.value}`);
      await syncDriveSharing({ branchId });
    } catch (e) {
      console.error("Technical inquiry Drive follow-up failed:", e instanceof Error ? e.message : e);
    }
    await syncInquiryPdf(input.id);
    // A team leader's case waits for the workshop supervisor; the technical team is told when it is verified.
    await notifyInquiry(user.role === "team_leader" ? "needs_verification" : "created", input.id, origin);
  });

  revalidateInquiries(input.id);
  return { id: input.id, no: Number(no) };
}

/** A comment (and files) on an inquiry, from the workshop or the technical team. */
export async function addInquiryComment(input: { id: string; inquiryId: string; body: string; attachments: InquiryAttachmentInput[]; internal?: boolean }): Promise<{ error?: string }> {
  const who = await inquiryUser();
  if ("error" in who) return { error: who.error };
  if (input.internal && isWorkshopRole(who.user.role)) return { error: "Not allowed." };
  if (input.internal && input.attachments.length > 0) return { error: "Internal notes cannot have files." };
  if (!UUID.test(input.id) || !UUID.test(input.inquiryId)) return { error: "Something went wrong - please reload the page and try again." };
  const body = input.body.trim();
  if (!body) return { error: "Write your comment." };
  if (body.length > INQUIRY_TEXT_MAX) return { error: `A comment can be at most ${INQUIRY_TEXT_MAX} characters.` };

  const verified = await verifyAttachments(input.inquiryId, input.attachments);
  if ("error" in verified) return { error: verified.error };

  const supabase = await createClient();
  const { data: newStatus, error } = await supabase.rpc("technical_inquiry_comment", {
    p_id: input.id,
    p_inquiry_id: input.inquiryId,
    p_body: body,
    p_attachments: verified.rows,
    p_internal: input.internal === true,
  });
  if (error && error.code !== "23505") return { error: error.message };

  if (verified.rows.length > 0) {
    after(async () => {
      try {
        await syncDriveSharing();
      } catch (e) {
        console.error("Drive sharing after an inquiry comment failed:", e instanceof Error ? e.message : e);
      }
    });
  }
  // An internal note is for the technical team only: no case-sheet update, no mail.
  // (A comment on a case that is still waiting for verification is a talk inside the workshop: no mail.)
  if (!input.internal && !error && newStatus !== "pending_verification" && newStatus !== "returned") afterCaseChange(isWorkshopRole(who.user.role) ? "workshop_reply" : "team_reply", input.inquiryId, await siteOrigin());
  revalidateInquiries(input.inquiryId);
  return {};
}

/** The technical team closes a case with a short summary of the solution. */
export async function closeTechnicalInquiry(input: { inquiryId: string; resolution: string }): Promise<{ error?: string }> {
  const who = await inquiryUser();
  if ("error" in who) return { error: who.error };
  if (!UUID.test(input.inquiryId)) return { error: "Something went wrong - please reload the page and try again." };
  if (input.resolution.trim().length > INQUIRY_TEXT_MAX) return { error: `The summary can be at most ${INQUIRY_TEXT_MAX} characters.` };
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_technical_inquiry", { p_inquiry_id: input.inquiryId, p_resolution: input.resolution });
  if (error) return { error: error.message };
  afterCaseChange("closed", input.inquiryId, await siteOrigin());
  revalidateInquiries(input.inquiryId);
  return {};
}

export async function reopenTechnicalInquiry(input: { inquiryId: string; comment?: string }): Promise<{ error?: string }> {
  const who = await inquiryUser();
  if ("error" in who) return { error: who.error };
  if (!UUID.test(input.inquiryId)) return { error: "Something went wrong - please reload the page and try again." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_technical_inquiry", { p_inquiry_id: input.inquiryId, p_comment: input.comment?.trim() || null });
  if (error) return { error: error.message };
  afterCaseChange("reopened", input.inquiryId, await siteOrigin());
  revalidateInquiries(input.inquiryId);
  return {};
}

/** The workshop withdraws a case nobody needs to answer any more. */
export async function cancelTechnicalInquiry(input: { inquiryId: string; reason?: string }): Promise<{ error?: string }> {
  const who = await inquiryUser();
  if ("error" in who) return { error: who.error };
  if (!UUID.test(input.inquiryId)) return { error: "Something went wrong - please reload the page and try again." };
  const reason = (input.reason ?? "").trim();
  if (reason.length > INQUIRY_TEXT_MAX) return { error: `The reason can be at most ${INQUIRY_TEXT_MAX} characters.` };
  const supabase = await createClient();
  const { data: before } = await supabase.from("self_audit_technical_inquiries").select("status").eq("id", input.inquiryId).maybeSingle();
  const { error } = await supabase.rpc("cancel_technical_inquiry", { p_inquiry_id: input.inquiryId, p_reason: reason || null });
  if (error) return { error: error.message };
  afterCaseChange(before?.status === "pending_verification" ? null : "cancelled", input.inquiryId, await siteOrigin());
  revalidateInquiries(input.inquiryId);
  return {};
}

/** The workshop sends a closed or cancelled case back to the technical team (the problem came back, or it was cancelled by mistake). */
export async function resubmitTechnicalInquiry(input: { inquiryId: string; comment: string }): Promise<{ error?: string }> {
  const who = await inquiryUser();
  if ("error" in who) return { error: who.error };
  if (!UUID.test(input.inquiryId)) return { error: "Something went wrong - please reload the page and try again." };
  const comment = input.comment.trim();
  if (!comment) return { error: "Say what has changed or why you are sending it again." };
  if (comment.length > INQUIRY_TEXT_MAX) return { error: `The text can be at most ${INQUIRY_TEXT_MAX} characters.` };
  const supabase = await createClient();
  const { error } = await supabase.rpc("resubmit_technical_inquiry", { p_inquiry_id: input.inquiryId, p_comment: comment });
  if (error) return { error: error.message };
  const { data: after } = await supabase.from("self_audit_technical_inquiries").select("status").eq("id", input.inquiryId).maybeSingle();
  afterCaseChange(after?.status === "pending_verification" ? "needs_verification" : "resubmitted", input.inquiryId, await siteOrigin());
  revalidateInquiries(input.inquiryId);
  return {};
}

/** The workshop supervisor verifies a team leader's case: only now does it reach the technical team. */
export async function verifyTechnicalInquiry(input: { inquiryId: string; comment?: string }): Promise<{ error?: string }> {
  const who = await inquiryUser();
  if ("error" in who) return { error: who.error };
  if (!UUID.test(input.inquiryId)) return { error: "Something went wrong - please reload the page and try again." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("verify_technical_inquiry", { p_inquiry_id: input.inquiryId, p_comment: input.comment?.trim() || null });
  if (error) return { error: error.message };
  afterCaseChange("verified", input.inquiryId, await siteOrigin());
  revalidateInquiries(input.inquiryId);
  return {};
}

/** The workshop supervisor sends a team leader's case back, with the reason (the team leader can fix it and send it again). */
export async function rejectTechnicalInquiry(input: { inquiryId: string; reason: string }): Promise<{ error?: string }> {
  const who = await inquiryUser();
  if ("error" in who) return { error: who.error };
  if (!UUID.test(input.inquiryId)) return { error: "Something went wrong - please reload the page and try again." };
  const reason = input.reason.trim();
  if (!reason) return { error: "Say why the case is rejected, so the team leader can fix it." };
  if (reason.length > INQUIRY_TEXT_MAX) return { error: `The reason can be at most ${INQUIRY_TEXT_MAX} characters.` };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_technical_inquiry", { p_inquiry_id: input.inquiryId, p_reason: reason });
  if (error) return { error: error.message };
  afterCaseChange("rejected", input.inquiryId, await siteOrigin());
  revalidateInquiries(input.inquiryId);
  return {};
}

/** The technical team gives a case to a technician (or takes it themselves). */
export async function assignTechnicalInquiry(input: { inquiryId: string; userId: string }): Promise<{ error?: string }> {
  const who = await inquiryUser();
  if ("error" in who) return { error: who.error };
  if (!UUID.test(input.inquiryId) || !UUID.test(input.userId)) return { error: "Something went wrong - please reload the page and try again." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_technical_inquiry", { p_inquiry_id: input.inquiryId, p_user_id: input.userId });
  if (error) return { error: error.message };
  // Giving the case to a colleague tells them; taking it yourself does not.
  afterCaseChange(input.userId === who.user.id ? null : "delegated", input.inquiryId, await siteOrigin());
  revalidateInquiries(input.inquiryId);
  return {};
}

/** Which technician looks after which branch (new cases of that branch are assigned to them automatically). Officers only. */
export async function saveInquiryRouting(input: { branchId: string; technicianId: string | null }): Promise<{ error?: string }> {
  const who = await inquiryUser();
  if ("error" in who) return { error: who.error };
  if (who.user.role !== "officer") return { error: "Only an officer can change who handles which branch." };
  if (!UUID.test(input.branchId) || (input.technicianId !== null && !UUID.test(input.technicianId))) return { error: "Something went wrong - please reload the page and try again." };
  const supabase = await createClient();
  const { error } = input.technicianId
    ? await supabase.from("self_audit_inquiry_routing").upsert({ branch_id: input.branchId, technician_id: input.technicianId })
    : await supabase.from("self_audit_inquiry_routing").delete().eq("branch_id", input.branchId);
  if (error) return { error: error.message };
  revalidateInquiries();
  return {};
}

export type SimilarInquiry = { id: string; no: number; status: string; workOrder: string; system: string; createdAt: string; resolution: string | null };

/** Earlier cases of the same vehicle (the database only shows the caller the cases they may see), newest first. */
export async function findSimilarInquiries(vin: string): Promise<{ cases: SimilarInquiry[] }> {
  const who = await inquiryUser();
  if ("error" in who) return { cases: [] };
  const clean = vin.trim().toUpperCase().replace(/\s+/g, "");
  if (!VIN_PATTERN.test(clean)) return { cases: [] };
  const supabase = await createClient();
  const { data } = await supabase
    .from("self_audit_technical_inquiries")
    .select("id, inquiry_no, status, work_order_no, system, created_at, resolution")
    .eq("vin", clean)
    .order("created_at", { ascending: false })
    .limit(5);
  return {
    cases: (data ?? []).map((i) => ({ id: i.id, no: i.inquiry_no, status: i.status, workOrder: i.work_order_no, system: i.system, createdAt: i.created_at, resolution: i.resolution })),
  };
}

/**
 * Returns a case to the team leader to complete documents or diagnosis (it is not cancelled): the workshop supervisor while
 * it waits for verification, or the technical team while they work on it (then it comes straight back to them).
 */
export async function returnTechnicalInquiry(input: { inquiryId: string; reason: string }): Promise<{ error?: string }> {
  const who = await inquiryUser();
  if ("error" in who) return { error: who.error };
  if (!UUID.test(input.inquiryId)) return { error: "Something went wrong - please reload the page and try again." };
  const reason = input.reason.trim();
  if (!reason) return { error: "Say what is missing, so the team leader can complete it." };
  if (reason.length > INQUIRY_TEXT_MAX) return { error: `The text can be at most ${INQUIRY_TEXT_MAX} characters.` };
  const supabase = await createClient();
  const { error } = await supabase.rpc("return_technical_inquiry", { p_inquiry_id: input.inquiryId, p_reason: reason });
  if (error) return { error: error.message };
  const { data: after } = await supabase.from("self_audit_technical_inquiries").select("returned_by").eq("id", input.inquiryId).maybeSingle();
  afterCaseChange(after?.returned_by === "technical" ? "returned_by_team" : "returned", input.inquiryId, await siteOrigin());
  revalidateInquiries(input.inquiryId);
  return {};
}

/** The team leader sends a returned (and completed) case back: to the supervisor, or straight to the technical team when they returned it. */
export async function sendInquiryToSupervisor(input: { inquiryId: string; comment?: string }): Promise<{ error?: string }> {
  const who = await inquiryUser();
  if ("error" in who) return { error: who.error };
  if (!UUID.test(input.inquiryId)) return { error: "Something went wrong - please reload the page and try again." };
  const comment = (input.comment ?? "").trim();
  if (comment.length > INQUIRY_TEXT_MAX) return { error: `The text can be at most ${INQUIRY_TEXT_MAX} characters.` };
  const supabase = await createClient();
  const { data: newStatus, error } = await supabase.rpc("send_inquiry_to_supervisor", { p_inquiry_id: input.inquiryId, p_comment: comment || null });
  if (error) return { error: error.message };
  // Returned by the technical team: straight back to them; returned by the supervisor: to the supervisor again.
  afterCaseChange(newStatus === "open" ? "resubmitted" : "needs_verification", input.inquiryId, await siteOrigin());
  revalidateInquiries(input.inquiryId);
  return {};
}

export type InquiryEditFields = {
  vin: string;
  plate_number: string;
  vehicle_model: string;
  system: string;
  vehicle_location: string;
  mileage_km: number;
  dtc_codes: string;
  software_version: string;
  occurrence: string;
  occurrence_conditions: string;
  parts_replaced: string;
  responsible_phone: string;
  concern_first_noticed: string;
  after_previous_repair: string;
  previous_repair_details: string;
  fault_complaint: string;
  workshop_comments: string;
};

/**
 * Edits a case's details. Allowed: the branch's workshop supervisor / branch admin, the team leader on his own case while
 * it waits for (or was returned by) the supervisor, and officers - the database checks it. The version before the edit is
 * kept for the technical team and officers.
 */
export async function editTechnicalInquiry(inquiryId: string, f: InquiryEditFields): Promise<{ error?: string }> {
  const who = await inquiryUser();
  if ("error" in who) return { error: who.error };
  if (!UUID.test(inquiryId)) return { error: "Something went wrong - please reload the page and try again." };
  const vin = f.vin.trim().toUpperCase().replace(/\s+/g, "");
  if (!VIN_PATTERN.test(vin)) return { error: "The VIN must be 17 letters and digits (no I, O or Q)." };
  if (!f.plate_number.trim()) return { error: "Enter the plate number." };
  if (!f.vehicle_model.trim()) return { error: "Enter the vehicle model." };
  if (!SYSTEMS.includes(f.system as never)) return { error: "Choose the vehicle system." };
  if (f.vehicle_location !== "in_workshop" && f.vehicle_location !== "out") return { error: "Say whether the car is in the workshop or out." };
  if (!Number.isInteger(f.mileage_km) || f.mileage_km < 0 || f.mileage_km > 2_000_000) return { error: "Enter a valid mileage." };
  if (f.occurrence !== "permanent" && f.occurrence !== "intermittent") return { error: "Say whether the concern is permanent or intermittent." };
  if (!["yes", "no", "unknown"].includes(f.after_previous_repair)) return { error: "Say whether it follows a previous repair." };
  if (f.after_previous_repair === "yes" && !f.previous_repair_details.trim()) return { error: "Say which previous repair it follows." };
  if (!f.fault_complaint.trim()) return { error: "Describe the customer concern." };
  if (!f.concern_first_noticed.trim()) return { error: "Say when the customer first noticed the concern." };
  for (const v of [f.fault_complaint, f.workshop_comments, f.parts_replaced, f.previous_repair_details, f.occurrence_conditions])
    if (v.length > INQUIRY_TEXT_MAX) return { error: `A text can be at most ${INQUIRY_TEXT_MAX} characters.` };
  const supabase = await createClient();
  const { error } = await supabase.rpc("edit_technical_inquiry", { p_inquiry_id: inquiryId, p_fields: { ...f, vin } });
  if (error) return { error: error.message };
  afterCaseChange(null, inquiryId, await siteOrigin()); // rewrite the case report with the new details
  revalidateInquiries(inquiryId);
  return {};
}
