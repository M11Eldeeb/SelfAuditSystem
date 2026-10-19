"use server";

import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAnyRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMailStatus, sendMail } from "@/lib/gmail";
import { renderMailText } from "@/lib/mail/template";
import { siteOrigin } from "@/lib/site-origin";

const WORKSHOP_ROLES = ["workshop_supervisor", "team_leader"] as const;
const ANSWER_ROLES = ["technical", "officer"] as const;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

type Photo = { base64: string; mimeType: string };
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

function checkPhoto(p: Photo | null | undefined): p is Photo & { mimeType: ImageType } {
  return !!p && (IMAGE_TYPES as readonly string[]).includes(p.mimeType) && p.base64.length > 0 && p.base64.length * 0.75 <= MAX_PHOTO_BYTES;
}

const PROMPTS = {
  vin: "This photo shows a vehicle VIN (17 characters, on a plate, sticker, windscreen or chassis stamp). Reply with the VIN only - 17 characters, capital letters and digits, no spaces. VINs never contain I, O or Q. If you cannot read a full VIN, reply UNREADABLE.",
  mileage: "This photo shows a vehicle's instrument cluster / odometer. Reply with the total odometer reading in km as digits only (no unit, no separators) - not the trip meter, not the range. If you cannot read it, reply UNREADABLE.",
} as const;

/** Reads the VIN or the odometer from a phone photo with Claude's vision; the user can still correct the result. */
export async function readVerificationPhoto(kind: "vin" | "mileage", photo: Photo): Promise<{ value?: string; error?: string }> {
  await requireAnyRole([...WORKSHOP_ROLES]);
  if (!checkPhoto(photo)) return { error: "Take a photo (JPG or PNG, under 8 MB)." };
  if (!process.env.ANTHROPIC_API_KEY) return { error: "Reading photos is not set up - type it in." };
  try {
    const client = new Anthropic();
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 2000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: photo.mimeType, data: photo.base64 } },
            { type: "text", text: PROMPTS[kind] },
          ],
        },
      ],
    });
    if (response.stop_reason === "refusal") return { error: "Could not read the photo - type it in." };
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ").trim().toUpperCase();
    if (kind === "vin") {
      const vin = text.replace(/[^A-Z0-9]/g, "");
      if (!VIN_RE.test(vin)) return { error: "Could not read a 17-character VIN - take a closer photo or type it in." };
      return { value: vin };
    }
    const km = text.replace(/[^0-9]/g, "");
    if (!km || text.includes("UNREADABLE")) return { error: "Could not read the mileage - take a closer photo or type it in." };
    return { value: String(Number(km)) };
  } catch {
    return { error: "Could not read the photo - type it in." };
  }
}

async function emailsOfRole(roles: string[]): Promise<string[]> {
  const { data } = await createAdminClient().from("self_audit_users").select("email, role").in("role", roles as never);
  return [...new Set((data ?? []).map((u) => u.email?.trim().toLowerCase()).filter((e): e is string => !!e))];
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
}): Promise<{ error?: string; id?: string; mailError?: string }> {
  const user = await requireAnyRole([...WORKSHOP_ROLES]);
  if (!user.branch_id) return { error: "Your account has no branch." };
  const vin = input.vin.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!VIN_RE.test(vin)) return { error: "The VIN must be 17 characters (letters and digits, no I, O or Q)." };
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
        `A new verification code request (#${row.request_no}) was submitted by ${user.full_name ?? user.email} - ${branchName}.`,
        `VIN: ${vin}\nMileage: ${Number(mileageDigits).toLocaleString("en-US")} km\nModule: ${moduleName}\nReason: ${reason}`,
        `Open the request: ${origin}/technical/verification-codes?open=${id}`,
        SIGN_OFF,
      ].join("\n\n");
      const mail = renderMailText(body, {});
      const res = await sendMail({
        kind: "verification-request",
        to,
        subject: `Verification Code Request #${row.request_no} - ${branchName} - ${moduleName}`,
        text: mail.text,
        html: mail.html,
        sentBy: user.id,
      });
      if (!res.ok) mailError = res.error;
    }
  }
  revalidatePath("/workshop/verification-codes");
  revalidatePath("/technical/verification-codes");
  revalidatePath("/admin/verification-codes");
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
  if (!row) return { error: "This request is already closed." };

  let mailError: string | undefined;
  if (row.created_by && (await getMailStatus())) {
    const { data: requester } = await admin.from("self_audit_users").select("email, full_name").eq("id", row.created_by).maybeSingle();
    if (requester?.email) {
      const body = [
        `Dear ${requester.full_name ?? "colleague"},`,
        `Your verification code request #${row.request_no} is closed.`,
        `VIN: ${row.vin}\nModule: ${row.module_name}`,
        `The verification code is: ${clean}`,
        SIGN_OFF,
      ].join("\n\n");
      const mail = renderMailText(body, {});
      const res = await sendMail({
        kind: "verification-code",
        to: [requester.email],
        subject: `Verification Code #${row.request_no} - ${row.module_name} - ${row.vin}`,
        text: mail.text,
        html: mail.html,
        sentBy: user.id,
      });
      if (!res.ok) mailError = res.error;
    }
  }
  revalidatePath("/workshop/verification-codes");
  revalidatePath("/technical/verification-codes");
  revalidatePath("/admin/verification-codes");
  return { mailError };
}
