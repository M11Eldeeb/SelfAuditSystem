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
  INQUIRY_MAX_FILES,
  INQUIRY_MAX_FILE_BYTES,
  INQUIRY_MAX_MILEAGE,
  INQUIRY_MAX_TERMS,
  INQUIRY_MODEL_MAX,
  INQUIRY_SHORT_TEXT_MAX,
  INQUIRY_SOFTWARE_MAX,
  INQUIRY_TERM_MAX,
  INQUIRY_TEXT_MAX,
  SYSTEMS,
  VIN_PATTERN,
  inquiryLabel,
  type InquirySystem,
} from "@/lib/technical-inquiries";

/** A file the browser has already uploaded to Google Drive. */
export type InquiryAttachmentInput = { driveFileId: string; name: string; type: string; size: number };

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
  for (const base of ["/admin/technical-inquiries", "/audit/technical-inquiries", "/technical/technical-inquiries"]) {
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
  if (files.length > INQUIRY_MAX_FILES) return `You can attach at most ${INQUIRY_MAX_FILES} files.`;
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
    const candidate = user.role === "branch_admin" ? user.branch_id : input.branchId;
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
async function verifyAttachments(inquiryId: string, files: InquiryAttachmentInput[]) {
  if (files.length === 0) return { rows: [] as { driveFileId: string; name: string; type: string; size: number }[] };
  if (files.length > INQUIRY_MAX_FILES) return { error: `You can attach at most ${INQUIRY_MAX_FILES} files.` };
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
      rows.push({ driveFileId: meta.id, name: meta.name, type: meta.mimeType, size: meta.size });
    }
  } catch (e) {
    return { error: driveMessage(e) };
  }
  return { rows };
}

export type CreateInquiryInput = {
  id: string;
  branchId?: string;
  workOrder: string;
  vin: string;
  model: string;
  system: string;
  priority: string;
  mileage?: number | null;
  dtc?: string;
  software?: string;
  occurrence?: string;
  conditions?: string;
  partsReplaced?: string;
  fault: string;
  actions: string;
  comments?: string;
  termsConfirmed: boolean;
  attachments: InquiryAttachmentInput[];
};

/** Submits a technical inquiry. A branch admin always submits for their own branch; an officer picks the branch. */
export async function createTechnicalInquiry(input: CreateInquiryInput): Promise<{ id?: string; no?: number; error?: string }> {
  const who = await inquiryUser();
  if ("error" in who) return { error: who.error };
  const { user } = who;
  if (user.role === "technical") return { error: "The technical team does not submit inquiries." };
  if (!UUID.test(input.id)) return { error: "Something went wrong - please reload the page and try again." };
  if (input.termsConfirmed !== true) return { error: "Confirm all the terms before submitting." };

  const supabase = await createClient();
  const branchId = user.role === "branch_admin" ? user.branch_id : input.branchId;
  if (!branchId || !UUID.test(branchId)) return { error: "Choose the branch." };
  const { data: branch } = await supabase.from("self_audit_branches").select("id, code").eq("id", branchId).maybeSingle();
  if (!branch) return { error: "Branch not found." };

  const wo = normalizeWorkOrder(input.workOrder, branch.code);
  if (wo.value === undefined) return { error: wo.error };
  const vin = input.vin.trim().toUpperCase().replace(/\s+/g, "");
  if (!VIN_PATTERN.test(vin)) return { error: "The VIN must be 17 letters and digits (no I, O or Q)." };
  const model = input.model.trim();
  if (!model) return { error: "Enter the vehicle model." };
  if (model.length > INQUIRY_MODEL_MAX) return { error: `The vehicle model can be at most ${INQUIRY_MODEL_MAX} characters.` };
  if (!(SYSTEMS as readonly string[]).includes(input.system)) return { error: "Choose the vehicle system the fault is in." };
  if (input.priority !== "normal" && input.priority !== "urgent") return { error: "Choose the priority." };
  const mileage = input.mileage == null || (input.mileage as unknown) === "" ? null : Number(input.mileage);
  if (mileage !== null && (!Number.isInteger(mileage) || mileage < 0 || mileage > INQUIRY_MAX_MILEAGE)) return { error: "The mileage must be a whole number of kilometres." };
  const dtc = (input.dtc ?? "").trim();
  const software = (input.software ?? "").trim();
  const occurrence = (input.occurrence ?? "").trim();
  const conditions = (input.conditions ?? "").trim();
  const partsReplaced = (input.partsReplaced ?? "").trim();
  if (occurrence && occurrence !== "constant" && occurrence !== "intermittent") return { error: "Choose constant or intermittent." };
  if (dtc.length > INQUIRY_DTC_MAX) return { error: `The fault codes can be at most ${INQUIRY_DTC_MAX} characters.` };
  if (software.length > INQUIRY_SOFTWARE_MAX) return { error: `The software version can be at most ${INQUIRY_SOFTWARE_MAX} characters.` };
  if (conditions.length > INQUIRY_SHORT_TEXT_MAX || partsReplaced.length > INQUIRY_SHORT_TEXT_MAX) return { error: `Those two fields can be at most ${INQUIRY_SHORT_TEXT_MAX} characters.` };
  const fault = input.fault.trim();
  const actions = input.actions.trim();
  const comments = (input.comments ?? "").trim();
  if (!fault) return { error: "Describe the fault complaint." };
  if (!actions) return { error: "Write what the workshop has done so far." };
  for (const [label, text] of [["fault complaint", fault], ["actions", actions], ["comments", comments]] as const) {
    if (text.length > INQUIRY_TEXT_MAX) return { error: `The ${label} can be at most ${INQUIRY_TEXT_MAX} characters.` };
  }

  const verified = await verifyAttachments(input.id, input.attachments);
  if ("error" in verified) return { error: verified.error };

  const { data: no, error } = await supabase.rpc("create_technical_inquiry", {
    p_id: input.id,
    p_branch_id: branchId,
    p_work_order: wo.value,
    p_vin: vin,
    p_model: model,
    p_system: input.system as InquirySystem,
    p_priority: input.priority,
    p_mileage: mileage,
    p_dtc: dtc || null,
    p_software: software || null,
    p_occurrence: occurrence || null,
    p_conditions: conditions || null,
    p_parts: partsReplaced || null,
    p_fault: fault,
    p_actions: actions,
    p_comments: comments || null,
    p_terms_confirmed: true,
    p_attachments: verified.rows,
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
    await notifyInquiry("created", input.id, origin);
  });

  revalidateInquiries(input.id);
  return { id: input.id, no: Number(no) };
}

/** A comment (and files) on an inquiry, from the workshop or the technical team. */
export async function addInquiryComment(input: { id: string; inquiryId: string; body: string; attachments: InquiryAttachmentInput[]; internal?: boolean }): Promise<{ error?: string }> {
  const who = await inquiryUser();
  if ("error" in who) return { error: who.error };
  if (input.internal && who.user.role === "branch_admin") return { error: "Not allowed." };
  if (input.internal && input.attachments.length > 0) return { error: "Internal notes cannot have files." };
  if (!UUID.test(input.id) || !UUID.test(input.inquiryId)) return { error: "Something went wrong - please reload the page and try again." };
  const body = input.body.trim();
  if (!body) return { error: "Write your comment." };
  if (body.length > INQUIRY_TEXT_MAX) return { error: `A comment can be at most ${INQUIRY_TEXT_MAX} characters.` };

  const verified = await verifyAttachments(input.inquiryId, input.attachments);
  if ("error" in verified) return { error: verified.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc("technical_inquiry_comment", {
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
  if (!input.internal && !error) afterCaseChange(who.user.role === "branch_admin" ? "workshop_reply" : "team_reply", input.inquiryId, await siteOrigin());
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
  const { error } = await supabase.rpc("cancel_technical_inquiry", { p_inquiry_id: input.inquiryId, p_reason: reason || null });
  if (error) return { error: error.message };
  afterCaseChange("cancelled", input.inquiryId, await siteOrigin());
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
  afterCaseChange("resubmitted", input.inquiryId, await siteOrigin());
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
  afterCaseChange(null, input.inquiryId, await siteOrigin());
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

/** An officer saves a new version of the terms every workshop must confirm. Nothing changes if the list is the same. */
export async function saveInquiryTerms(terms: string[]): Promise<{ error?: string }> {
  const who = await inquiryUser();
  if ("error" in who) return { error: who.error };
  if (who.user.role !== "officer") return { error: "Only an officer can change the terms." };
  const clean = terms.map((t) => t.trim()).filter(Boolean);
  if (clean.length === 0) return { error: "Add at least one term." };
  if (clean.length > INQUIRY_MAX_TERMS) return { error: `At most ${INQUIRY_MAX_TERMS} terms.` };
  if (clean.some((t) => t.length > INQUIRY_TERM_MAX)) return { error: `Each term can be at most ${INQUIRY_TERM_MAX} characters.` };

  const supabase = await createClient();
  const { data: latest } = await supabase.from("self_audit_inquiry_term_sets").select("terms").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (latest && latest.terms.length === clean.length && latest.terms.every((t, i) => t === clean[i])) return {};
  const { error } = await supabase.from("self_audit_inquiry_term_sets").insert({ terms: clean, created_by: who.user.id });
  if (error) return { error: error.message };
  revalidateInquiries();
  return {};
}
