import { createAdminClient } from "@/lib/supabase/admin";

function Stat({ label, n, total }: { label: string; n: number; total: number }) {
  return (
    <div className="rounded-lg bg-neutral-50 px-3 py-2">
      <div className="text-[11px] font-semibold text-neutral-500 uppercase">{label}</div>
      <div className="text-lg font-bold text-neutral-900">
        {total ? `${Math.round((n / total) * 100)}%` : "—"} <span className="text-xs font-normal text-neutral-500">({n} of {total})</span>
      </div>
    </div>
  );
}

/**
 * Officer-only trial of the phone's photo reader: how often its silent guess matched what the workshop typed.
 * After about 100 requests this shows whether it is good enough to fill the fields by itself.
 */
export async function OcrAccuracy() {
  const { data } = await createAdminClient().from("self_audit_verification_requests").select("vin, mileage, vin_ocr, mileage_ocr");
  const rows = data ?? [];
  const vinMatch = rows.filter((r) => r.vin_ocr && r.vin_ocr === r.vin).length;
  const kmMatch = rows.filter((r) => r.mileage_ocr && r.mileage != null && Number(r.mileage_ocr) === r.mileage).length;
  return (
    <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200/70">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-neutral-900">Photo reader trial</h2>
        <span className="text-xs text-neutral-500">{rows.length < 100 ? `${rows.length} / 100 requests` : "100+ requests - ready to decide"}</span>
      </div>
      <p className="mb-3 text-xs text-neutral-500">The workshop types the VIN and mileage; the phone reads the photos in the background (free, on-device). Matches with what they typed:</p>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="VIN read correctly" n={vinMatch} total={rows.length} />
        <Stat label="Mileage read correctly" n={kmMatch} total={rows.length} />
      </div>
    </section>
  );
}
