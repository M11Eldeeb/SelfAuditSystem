"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createVerificationRequest, readVerificationPhoto } from "@/app/actions/verification-requests";
import { CopyText } from "./copy-text";

type Photo = { base64: string; mimeType: string; preview: string };

/** Phone photos are large: scale to at most 1600px on the long side and re-encode as JPEG before sending. */
async function shrink(file: File): Promise<Photo> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { base64: dataUrl.split(",")[1] ?? "", mimeType: "image/jpeg", preview: dataUrl };
}

function PhotoField({
  kind,
  label,
  photo,
  value,
  onPhoto,
  onValue,
  placeholder,
  inputMode,
}: {
  kind: "vin" | "mileage";
  label: string;
  photo: Photo | null;
  value: string;
  onPhoto: (p: Photo | null) => void;
  onValue: (v: string) => void;
  placeholder: string;
  inputMode: "text" | "numeric";
}) {
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setNote(null);
    setReading(true);
    try {
      const p = await shrink(file);
      onPhoto(p);
      const res = await readVerificationPhoto(kind, { base64: p.base64, mimeType: p.mimeType });
      if (res.value) onValue(res.value);
      else setNote(res.error ?? "Could not read the photo - type it in.");
    } catch {
      setNote("Could not open the photo - try again.");
    } finally {
      setReading(false);
    }
  }

  return (
    <div className="space-y-2 rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
      <div className="text-sm font-semibold text-neutral-900">{label}</div>
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-neutral-300 px-4 py-4 text-sm font-medium text-neutral-700 hover:border-brand hover:text-brand">
        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.preview} alt="" className="h-24 rounded-md object-cover" />
        ) : (
          <span>📷 Take photo</span>
        )}
        {photo && <span className="text-xs">Retake</span>}
      </label>
      {reading && <p className="text-xs text-blue-700">Reading the photo...</p>}
      {note && <p className="text-xs text-amber-700">{note}</p>}
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => onValue(kind === "vin" ? e.target.value.toUpperCase() : e.target.value.replace(/[^0-9]/g, ""))}
          placeholder={placeholder}
          inputMode={inputMode}
          className={`min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-base focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none ${kind === "vin" ? "font-mono tracking-wide" : ""}`}
        />
        {value && <CopyText value={value} label=" " />}
      </div>
    </div>
  );
}

export function VerificationRequestForm() {
  const router = useRouter();
  const [vin, setVin] = useState("");
  const [mileage, setMileage] = useState("");
  const [vinPhoto, setVinPhoto] = useState<Photo | null>(null);
  const [mileagePhoto, setMileagePhoto] = useState<Photo | null>(null);
  const [moduleName, setModuleName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    const strip = (p: Photo | null) => (p ? { base64: p.base64, mimeType: p.mimeType } : null);
    const res = await createVerificationRequest({ vin, mileage, moduleName, reason, vinPhoto: strip(vinPhoto), mileagePhoto: strip(mileagePhoto) });
    setBusy(false);
    if (res.error) {
      setMsg({ ok: false, text: res.error });
      return;
    }
    setMsg({ ok: true, text: res.mailError ? `Request sent, but the e-mail to the technical team failed: ${res.mailError}` : "Request sent to the technical team. You will get the code by e-mail." });
    setVin("");
    setMileage("");
    setVinPhoto(null);
    setMileagePhoto(null);
    setModuleName("");
    setReason("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <PhotoField kind="vin" label="VIN number" photo={vinPhoto} value={vin} onPhoto={setVinPhoto} onValue={setVin} placeholder="17-character VIN" inputMode="text" />
      <PhotoField kind="mileage" label="Mileage" photo={mileagePhoto} value={mileage} onPhoto={setMileagePhoto} onValue={setMileage} placeholder="km" inputMode="numeric" />
      <div className="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
        <label className="block space-y-1">
          <span className="text-sm font-semibold text-neutral-900">Module name</span>
          <input
            value={moduleName}
            onChange={(e) => setModuleName(e.target.value)}
            placeholder="e.g. BCM, ECM, TCU, IPK"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-base focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-semibold text-neutral-900">Reason</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Why is the code needed?"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-base focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
          />
        </label>
      </div>
      {msg && <p className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}
      <button type="submit" disabled={busy} className="w-full rounded-xl bg-brand px-4 py-3 text-base font-semibold text-white shadow-sm shadow-brand/25 hover:bg-brand-dark disabled:opacity-50">
        {busy ? "Sending..." : "Send request"}
      </button>
    </form>
  );
}
