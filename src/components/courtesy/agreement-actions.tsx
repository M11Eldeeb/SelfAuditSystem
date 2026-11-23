"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { cancelCourtesyAgreement, returnCourtesyCar } from "@/app/actions/courtesy-agreements";
import { FuelPicker } from "@/components/courtesy/handover-form";

/** The car came back: mileage and fuel in, a note; closes the agreement. */
export function ReturnForm({ id, mileageOut }: { id: string; mileageOut: number | null }) {
  const router = useRouter();
  const [km, setKm] = useState("");
  const [fuel, setFuel] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm";
  return (
    <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
      <h2 className="font-bold text-neutral-900">Car returned</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-semibold text-neutral-800">
          Mileage in (km){mileageOut != null && <span className="font-normal text-neutral-500"> - out was {mileageOut.toLocaleString("en-US")}</span>}
          <input className={input} inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value.replace(/\D/g, "").slice(0, 7))} />
        </label>
        <div className="space-y-1 text-sm font-semibold text-neutral-800">
          Fuel level at return
          <FuelPicker value={fuel} onChange={setFuel} />
        </div>
      </div>
      <textarea rows={2} className={input} placeholder="Note (new damage, smoke smell, ...)" value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setError(null);
          if (!km) return setError("Enter the mileage in.");
          if (fuel == null) return setError("Choose the fuel level.");
          setBusy(true);
          const r = await returnCourtesyCar(id, { mileageIn: Number(km), fuelIn: fuel, note });
          setBusy(false);
          if (r.error) setError(r.error);
          else router.refresh();
        }}
        className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Close the agreement"}
      </button>
    </section>
  );
}

export function CancelButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm("Cancel this courtesy car request?")) return;
        setBusy(true);
        const r = await cancelCourtesyAgreement(id);
        setBusy(false);
        if (r.error) window.alert(r.error);
        else router.refresh();
      }}
      className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
    >
      Cancel request
    </button>
  );
}

/** The branch's customer link: copy it, show its QR code; "my link" picks the advisor for the customer. */
export function CustomerLink({ url, myUrl, posterUrl }: { url: string; myUrl: string | null; posterUrl: string }) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (u: string) => {
    await navigator.clipboard.writeText(u).catch(() => undefined);
    setCopied(u);
    setTimeout(() => setCopied(null), 2000);
  };
  return (
    <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-bold text-neutral-900">Customer link</h2>
          <p className="text-sm text-neutral-600">Send it to the customer or let him scan the QR code: he fills in his details in Arabic or English, reads the terms and signs. You get an e-mail when he submits.</p>
        </div>
        <span className="flex flex-wrap gap-2">
        <a href={posterUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
          QR poster (PDF)
        </a>
        <button
          type="button"
          onClick={async () => setQr(qr ? null : await QRCode.toDataURL(myUrl ?? url, { margin: 1, width: 320 }))}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-800 hover:bg-neutral-50"
        >
          {qr ? "Hide QR code" : "Show QR code"}
        </button>
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {[...(myUrl ? [{ u: myUrl, l: "My link (I am chosen)" }] : []), { u: url, l: "Branch link" }].map((x) => (
          <div key={x.u} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-sm">
            <span className="shrink-0 font-semibold text-neutral-700">{x.l}:</span>
            <span className="min-w-0 truncate font-mono text-xs text-neutral-600" dir="ltr">
              {x.u}
            </span>
            <button type="button" onClick={() => void copy(x.u)} className="ml-auto shrink-0 rounded-md bg-white px-2 py-1 text-xs font-semibold ring-1 ring-black/10">
              {copied === x.u ? "Copied ✓" : "Copy"}
            </button>
          </div>
        ))}
      </div>
      {qr && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr} alt="QR code of the customer link" className="mx-auto h-56 w-56" />
      )}
    </section>
  );
}
