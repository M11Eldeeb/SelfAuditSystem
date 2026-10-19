"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAnyRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMailStatus, sendMail } from "@/lib/gmail";
import { renderMailText } from "@/lib/mail/template";
import { siteOrigin } from "@/lib/site-origin";

const WORKSHOP_ROLES = ["branch_admin", "workshop_supervisor", "team_leader"] as const;
const ANSWER_ROLES = ["technical", "officer"] as const;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

type Photo = { base64: string; mimeType: string };
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

function checkPhoto(p: Photo | null | undefined): p is Photo & { mimeType: ImageType } {
  return !!p && (IMAGE_TYPES as readonly string[]).includes(p.mimeType) && p.base64.length > 0 && p.base64.length * 0.75 <= MAX_PHOTO_BYTES;
}

async function emailsOfRole(roles: string[]): Promise<string[]> {
  const { data } = await createAdminClient().from("self_audit_users").select("email, role").in("role", roles as never);
  return [...new Set((data ?? []).map((u) => u.email?.trim().toLowerCase()).filter((e): e is string => !!e))];
}

function revalidateAll() {
  for (const p of ["/workshop/technical-inquiries", "/audit/technical-inquiries", "/technical/technical-inquiries", "/admin/technical-inquiries", "/admin/dashboard", "/audit/dashboard"]) revalidatePath(p);
}

/** Always in Cc of a new request. */
const WARRANTY_TEAM_CC = "warranty.team@jiadmotors.com";

/** Cc of an answer (code / rejection): the technical team, plus whoever answered if they are not on it (e.g. an officer). */
async function answerCc(user: { email: string | null; role: string }): Promise<string[]> {
  const team = await emailsOfRole(["technical"]);
  const me = user.email?.trim().toLowerCase();
  return me && user.role !== "technical" && !team.includes(me) ? [...team, me] : team;
}

const SIGN_OFF = "Thank you,\nWarranty Department - Jiad Modern Motors";

/** Submits a request from the workshop and e-mails the technical team. */
export async function createVerificationRequest(input: {
  vin: string;
  mileage: string;
  moduleName: string;
  reason: string;
  vinPhoto: Photo | null;
  mileagePhoto: Photo | null;
  /** What the phone's reader made of the photos (not shown to the user) - kept to measure its accuracy. */
  vinOcr?: string | null;
  mileageOcr?: string | null;
}): Promise<{ error?: string; id?: string; mailError?: string }> {
  const user = await requireAnyRole([...WORKSHOP_ROLES]);
  if (!user.branch_id) return { error: "Your account has no branch." };
  const vin = input.vin.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!vin) return { error: "Enter the VIN." };
  if (vin.length > 30) return { error: "The VIN is too long." };
  const mileageDigits = input.mileage.replace(/[^0-9]/g, "");
  if (!mileageDigits) return { error: "Enter the mileage." };
  const moduleName = input.moduleName.trim().slice(0, 120);
  const reason = input.reason.trim().slice(0, 2000);
  if (!moduleName) return { error: "Enter the module name." };
  if (!reason) return { error: "Enter the reason." };
  if (!checkPhoto(input.vinPhoto) || !checkPhoto(input.mileagePhoto)) return { error: "Take both photos - the VIN and the mileage." };

  const admin = createAdminClient();
  const id = randomUUID();
  const upload = async (photo: Photo, name: string) => {
    const ext = photo.mimeType === "image/png" ? "png" : photo.mimeType === "image/webp" ? "webp" : "jpg";
    const path = `${user.branch_id}/${id}/${name}.${ext}`;
    const { error } = await admin.storage.from("verification-photos").upload(path, Buffer.from(photo.base64, "base64"), { contentType: photo.mimeType });
    if (error) throw new Error(error.message);
    return path;
  };
  let vinPath: string, mileagePath: string;
  try {
    [vinPath, mileagePath] = await Promise.all([upload(input.vinPhoto, "vin"), upload(input.mileagePhoto, "mileage")]);
  } catch {
    return { error: "Could not save the photos - please try again." };
  }

  const { data: row, error } = await admin
    .from("self_audit_verification_requests")
    .insert({
      id,
      branch_id: user.branch_id,
      vin,
      mileage: Number(mileageDigits),
      vin_photo_path: vinPath,
      mileage_photo_path: mileagePath,
      vin_ocr: input.vinOcr?.slice(0, 40) || null,
      mileage_ocr: input.mileageOcr?.slice(0, 20) || null,
      module_name: moduleName,
      reason,
      created_by: user.id,
      created_by_name: user.full_name ?? user.email,
    })
    .select("request_no")
    .single();
  if (error || !row) return { error: error?.message ?? "Could not save the request." };

  // E-mail the technical team (a failed mail does not undo the request).
  let mailError: string | undefined;
  if (await getMailStatus()) {
    const [{ data: branch }, to] = await Promise.all([
      admin.from("self_audit_branches").select("name").eq("id", user.branch_id).maybeSingle(),
      emailsOfRole(["technical"]),
    ]);
    if (to.length) {
      const origin = await siteOrigin();
      const branchName = branch?.name ?? "Branch";
      const body = [
        "Dear Technical Team,",
        `A new verification code request (VC-${String(row.request_no).padStart(4, "0")}) was submitted by ${user.full_name ?? user.email} - ${branchName}.`,
        `VIN: ${vin}\nMileage: ${Number(mileageDigits).toLocaleString("en-US")} km\nModule: ${moduleName}\nReason: ${reason}`,
        `Open the request: ${origin}/technical/technical-inquiries?view=codes&open=${id}`,
        SIGN_OFF,
      ].join("\n\n");
      const mail = renderMailText(body, {});
      const res = await sendMail({
        kind: "verification-request",
        to,
        cc: [WARRANTY_TEAM_CC],
        subject: `Verification Code Request VC-${String(row.request_no).padStart(4, "0")} - ${branchName} - ${moduleName}`,
        text: mail.text,
        html: mail.html,
        sentBy: user.id,
      });
      if (!res.ok) mailError = res.error;
    }
  }
  revalidateAll();
  return { id, mailError };
}

/** The technical team / an officer enters the code: the request closes and the requester gets an e-mail with it. */
export async function closeVerificationRequest(id: string, code: string): Promise<{ error?: string; mailError?: string }> {
  const user = await requireAnyRole([...ANSWER_ROLES]);
  const clean = code.trim().slice(0, 200);
  if (!clean) return { error: "Enter the verification code." };
  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("self_audit_verification_requests")
    .update({ status: "closed", code: clean, closed_by: user.id, closed_by_name: user.full_name ?? user.email, closed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "open")
    .select("request_no, vin, module_name, created_by")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!row) return { error: "This request is already answered." };

  let mailError: string | undefined;
  if (row.created_by && (await getMailStatus())) {
    const { data: requester } = await admin.from("self_audit_users").select("email, full_name").eq("id", row.created_by).maybeSingle();
    if (requester?.email) {
      const body = [
        `Dear ${requester.full_name ?? "colleague"},`,
        `Your verification code request VC-${String(row.request_no).padStart(4, "0")} is closed.`,
        `VIN: ${row.vin}\nModule: ${row.module_name}`,
        `The verification code is: ${clean}`,
        SIGN_OFF,
      ].join("\n\n");
      const mail = renderMailText(body, {});
      const res = await sendMail({
        kind: "verification-code",
        to: [requester.email],
        cc: await answerCc(user),
        subject: `Verification Code VC-${String(row.request_no).padStart(4, "0")} - ${row.module_name} - ${row.vin}`,
        text: mail.text,
        html: mail.html,
        sentBy: user.id,
      });
      if (!res.ok) mailError = res.error;
    }
  }
  revalidateAll();
  return { mailError };
}

/** The technical team / an officer rejects a request with a reason; the requester is e-mailed the reason. */
export async function rejectVerificationRequest(id: string, reason: string): Promise<{ error?: string; mailError?: string }> {
  const user = await requireAnyRole([...ANSWER_ROLES]);
  const clean = reason.trim().slice(0, 1000);
  if (!clean) return { error: "Write the reason for rejecting." };
  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("self_audit_verification_requests")
    .update({ status: "rejected", reject_reason: clean, closed_by: user.id, closed_by_name: user.full_name ?? user.email, closed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "open")
    .select("request_no, vin, module_name, created_by")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!row) return { error: "This request is already answered." };

  let mailError: string | undefined;
  if (row.created_by && (await getMailStatus())) {
    const { data: requester } = await admin.from("self_audit_users").select("email, full_name").eq("id", row.created_by).maybeSingle();
    if (requester?.email) {
      const body = [
        `Dear ${requester.full_name ?? "colleague"},`,
        `Your verification code request VC-${String(row.request_no).padStart(4, "0")} was rejected.`,
        `VIN: ${row.vin}\nModule: ${row.module_name}`,
        `Reason: ${clean}`,
        "You can send a new request with the missing details.",
        SIGN_OFF,
      ].join("\n\n");
      const mail = renderMailText(body, {});
      const res = await sendMail({
        kind: "verification-rejected",
        to: [requester.email],
        cc: await answerCc(user),
        subject: `Verification Code Request VC-${String(row.request_no).padStart(4, "0")} rejected - ${row.module_name} - ${row.vin}`,
        text: mail.text,
        html: mail.html,
        sentBy: user.id,
      });
      if (!res.ok) mailError = res.error;
    }
  }
  revalidateAll();
  return { mailError };
}
