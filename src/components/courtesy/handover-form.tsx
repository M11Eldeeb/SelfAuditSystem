"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { handOverCourtesyCar, uploadCourtesyPhoto } from "@/app/actions/courtesy-agreements";
import { FUEL_STEPS, type DamageMark } from "@/lib/courtesy/agreements";
import type { FleetCar } from "@/lib/courtesy/agreements-server";
import { DamageDiagram } from "@/components/courtesy/damage-diagram";
import { SignaturePad, shrinkPhoto } from "@/components/courtesy/signature-pad";

export function FuelPicker({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Fuel level">
      {FUEL_STEPS.map((v, i) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={`min-w-11 rounded-lg px-2 py-2 text-xs font-bold ring-1 ${value === v ? "bg-neutral-900 text-white ring-neutral-900" : "bg-white text-neutral-800 ring-black/10 hover:bg-neutral-50"}`}
        >
          {i === 0 ? "E" : i === 8 ? "F" : `${i}/8`}
        </button>
      ))}
    </div>
  );
}

/** The advisor's handover: the car, mileage, fuel, damages, WIP, expiry, notes, photos, signature. */
export function HandoverForm({ id, cars, carsError, defaultExpiry }: { id: string; cars: FleetCar[]; carsError?: string; defaultExpiry: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [car, setCar] = useState<FleetCar | null>(null);
  const [manual, setManual] = useState(cars.length === 0);
  const [manualCar, setManualCar] = useState({ model: "", plate: "", vin: "" });
  const [km, setKm] = useState("");
  const [fuel, setFuel] = useState<number | null>(null);
  const [marks, setMarks] = useState<DamageMark[]>([]);
  const [wip, setWip] = useState("");
  const [expiry, setExpiry] = useState(defaultExpiry);
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<{ path: string; preview: string }[]>([]);
  const [uploading, setUploading] = useState(0);
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? cars.filter((c) => c.label.toLowerCase().includes(t)) : cars;
  }, [cars, q]);

  async function addPhotos(files: FileList | null) {
    const all = Array.from(files ?? []);
    setUploading((n) => n + all.length);
    for (const f of all) {
      try {
        const p = await shrinkPhoto(f);
        const r = await uploadCourtesyPhoto(id, p);
        if (r.path) setPhotos((cur) => [...cur, { path: r.path!, preview: `data:${p.mimeType};base64,${p.base64}` }]);
        else setError(r.error ?? "Could not add the photo.");
      } catch {
        setError(`"${f.name}" could not be read.`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  async function submit() {
    setError(null);
    const vehicle = manual ? { ...manualCar, label: [manualCar.model, manualCar.plate, manualCar.vin].filter(Boolean).join("  ") } : car;
    if (!vehicle?.plate) return setError("Choose the courtesy car.");
    if (!km) return setError("Enter the mileage out.");
    if (fuel == null) return setError("Choose the fuel level.");
    if (!wip.trim()) return setError("Enter the WIP number.");
    if (!expiry) return setError("Choose the agreement expiry.");
    if (!signature) return setError("Sign in the box.");
    if (uploading) return setError("Wait for the photos to finish uploading.");
    setBusy(true);
    const r = await handOverCourtesyCar(id, { vehicle, mileageOut: Number(km), fuelOut: fuel, damages: marks, wipNo: wip, expiresAt: new Date(expiry).toISOString(), notes, signature, photos: photos.map((p) => p.path) });
    setBusy(false);
    if (r.error) return setError(r.error);
    router.refresh();
  }

  const input = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none";
  const label = "mb-1 block text-sm font-semibold text-neutral-800";
  return (
    <section className="space-y-5 rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70 sm:p-5">
      <h2 className="text-lg font-bold text-neutral-900">Hand over the courtesy car</h2>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className={label}>Courtesy car</span>
          <button type="button" onClick={() => setManual((m) => !m)} className="text-xs font-semibold text-brand underline">
            {manual ? "Choose from the available cars" : "Not in the list - type it"}
          </button>
        </div>
        {manual ? (
          <div className="grid gap-2 sm:grid-cols-3">
            <input className={input} placeholder="Model (e.g. MG Whale)" value={manualCar.model} onChange={(e) => setManualCar({ ...manualCar, model: e.target.value })} />
            <input className={input} placeholder="Plate (e.g. 6755 BNR)" value={manualCar.plate} onChange={(e) => setManualCar({ ...manualCar, plate: e.target.value })} />
            <input className={input} placeholder="VIN" value={manualCar.vin} onChange={(e) => setManualCar({ ...manualCar, vin: e.target.value.toUpperCase() })} />
          </div>
        ) : (
          <div className="space-y-2">
            <input className={input} placeholder={`Search ${cars.length} available cars (plate, model, VIN)`} value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="max-h-56 divide-y divide-neutral-100 overflow-y-auto rounded-lg border border-neutral-200">
              {list.map((c) => (
                <button key={`${c.plate}|${c.vin}`} type="button" onClick={() => setCar(c)} className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${car === c ? "bg-neutral-900 text-white" : "hover:bg-neutral-50"}`}>
                  <span className="font-semibold">{c.plate}</span>
                  <span className={`truncate text-xs ${car === c ? "text-white/80" : "text-neutral-500"}`}>
                    {c.model} {c.vin}
                  </span>
                </button>
              ))}
              {list.length === 0 && <p className="px-3 py-4 text-center text-sm text-neutral-500">{carsError ? `The courtesy cars sheet could not be read (${carsError}).` : "No available car matches."}</p>}
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className={label} htmlFor="ho-km">Mileage out (km)</label>
          <input id="ho-km" className={input} inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value.replace(/\D/g, "").slice(0, 7))} />
        </div>
        <div>
          <label className={label} htmlFor="ho-wip">WIP number</label>
          <input id="ho-wip" className={input} inputMode="numeric" value={wip} onChange={(e) => setWip(e.target.value.replace(/\D/g, "").slice(0, 10))} />
        </div>
        <div>
          <label className={label} htmlFor="ho-exp">Agreement expiry</label>
          <input id="ho-exp" type="datetime-local" className={input} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </div>
      </div>

      <div>
        <span className={label}>Fuel level at checkout</span>
        <FuelPicker value={fuel} onChange={setFuel} />
      </div>

      <div>
        <span className={label}>Damages (walk-around)</span>
        <DamageDiagram marks={marks} onChange={setMarks} />
      </div>

      <div>
        <label className={label} htmlFor="ho-notes">Notes (optional)</label>
        <textarea id="ho-notes" rows={2} className={input} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div>
        <span className={label}>Photos of the car (optional)</span>
        <div className="flex flex-wrap gap-2">
          {photos.map((p) => (
            <div key={p.path} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.preview} alt="" className="h-20 w-28 rounded-lg object-cover ring-1 ring-black/10" />
              <button type="button" onClick={() => setPhotos((cur) => cur.filter((x) => x.path !== p.path))} className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-neutral-900 text-xs text-white" aria-label="Remove photo">
                ✕
              </button>
            </div>
          ))}
          <label className="flex h-20 w-28 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 text-xs font-semibold text-neutral-600 hover:bg-neutral-50">
            {uploading ? `Uploading ${uploading}…` : "+ Add photos"}
            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void addPhotos(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
      </div>

      <div>
        <span className={label}>Your signature (authorized MG signatory)</span>
        <SignaturePad onChange={setSignature} hint="Sign with your finger or the mouse" />
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button type="button" disabled={busy} onClick={() => void submit()} className="w-full rounded-xl bg-brand px-4 py-3 text-base font-bold text-white hover:bg-brand-dark disabled:opacity-60">
        {busy ? "Saving…" : "Hand over the car - open the agreement"}
      </button>
    </section>
  );
}
