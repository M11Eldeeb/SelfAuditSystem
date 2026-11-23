import "server-only";
import { DRIVE_SHARED_DRIVE_ID, createFileWithBytes, ensureFolder, getDriveStatus } from "@/lib/google-drive";
import { agreementsTable, readFile } from "./agreements-server";

const safe = (v: string) => v.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "-";

/**
 * Copies a handover's or a return's car photos to Google Drive:
 * Courtesy Cars / <model> / <VIN - plate> / <mileage> Km / photo files - and keeps the folder on the agreement.
 * The photos stay in the portal too (the agreement PDF uses them). Never throws.
 */
export async function photosToDrive(input: { agreementId: string; ref: string; when: "out" | "in"; vehicleKey: string; model: string | null; vin: string | null; plate: string; km: number; paths: string[] }): Promise<void> {
  try {
    if (!input.paths.length || !(await getDriveStatus())) return;
    const root = await ensureFolder("cc:root", "Courtesy Cars", DRIVE_SHARED_DRIVE_ID);
    const model = safe(input.model || "Other");
    const modelFolder = await ensureFolder(`cc:model:${model.toLowerCase()}`, model, root);
    const car = await ensureFolder(`cc:car:${input.vehicleKey}`, safe(`${input.vin || "No VIN"} - ${input.plate}`), modelFolder);
    const km = await ensureFolder(`cc:km:${input.vehicleKey}:${input.km}`, `${input.km} Km`, car);
    let n = 0;
    for (const p of input.paths) {
      const bytes = await readFile(p);
      if (!bytes) continue;
      const ext = p.split(".").pop()?.toLowerCase() || "jpg";
      n++;
      await createFileWithBytes({ parentId: km, name: `${input.ref} ${input.when === "out" ? "handover" : "return"} ${n}.${ext}`, mimeType: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg", bytes: new Uint8Array(bytes) });
    }
    await agreementsTable().update(input.when === "out" ? { drive_folder_out: km } : { drive_folder_in: km }).eq("id", input.agreementId);
  } catch (e) {
    console.error("Courtesy photos to Drive failed:", e instanceof Error ? e.message : e);
  }
}
