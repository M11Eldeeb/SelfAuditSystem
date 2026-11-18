"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addManualAppointment, deleteManualAppointment } from "@/app/actions/queue-appointments";

const input = "h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none focus:border-brand";

/** "Add appointment": for a service advisor or the queue manager, an appointment made by hand (not in the DMS sheet). */
export function AddAppointment({ branches, defaultBranchId, defaultDate }: { branches: { id: string; name: string }[]; defaultBranchId: string; defaultDate: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("");
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [wip, setWip] = useState("");
  const [vin, setVin] = useState("");
  const [services, setServices] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toggle = (s: string) => setServices((l) => (l.includes(s) ? l.filter((x) => x !== s) : [...l, s]));
  const reset = () => {
    setTime("");
    setName("");
    setMobile("");
    setWip("");
    setVin("");
    setServices([]);
    setNote("");
    setError(null);
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">
        + Add appointment
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Add appointment">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              start(async () => {
                const r = await addManualAppointment({ branchId, date, time, name, mobile, wip, vin, services, note });
                if (r.error) return setError(r.error);
                reset();
                setOpen(false);
                router.refresh();
              });
            }}
            className="max-h-[92dvh] w-full max-w-lg space-y-3 overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
          >
            <div>
              <h2 className="text-lg font-semibold text-neutral-900">Add appointment</h2>
              <p className="text-sm text-neutral-500">For an appointment made by hand. The customer is found at the kiosk by mobile or WIP, like the DMS sheet.</p>
            </div>
            {branches.length > 1 && (
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-neutral-700">Branch</span>
                <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={input}>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-neutral-700">Date</span>
                <input type="date" required value={date} min={defaultDate} onChange={(e) => setDate(e.target.value)} className={input} />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-neutral-700">Time</span>
                <input type="time" required value={time} step={900} onChange={(e) => setTime(e.target.value)} className={input} />
              </label>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-neutral-700">Customer name</span>
              <input required value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={input} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-neutral-700">Mobile</span>
              <div className="flex h-10 items-center rounded-lg border border-neutral-200 bg-white px-3 focus-within:border-brand" dir="ltr">
                <span className="text-neutral-500">+966</span>
                <span className="mx-2 h-5 w-px bg-neutral-200" />
                <input
                  required
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").replace(/^0+/, "").slice(0, 9))}
                  inputMode="numeric"
                  placeholder="5XXXXXXXX"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </div>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-neutral-700">WIP</span>
                <input required value={wip} onChange={(e) => setWip(e.target.value.replace(/\D/g, "").slice(0, 12))} inputMode="numeric" dir="ltr" className={input} />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-neutral-700">
                  VIN <span className="font-normal text-neutral-500">(optional)</span>
                </span>
                <input value={vin} onChange={(e) => setVin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 17))} dir="ltr" className={`${input} font-mono`} />
              </label>
            </div>
            <fieldset className="text-sm">
              <legend className="mb-1 font-medium text-neutral-700">Service (one or both)</legend>
              <div className="flex gap-2">
                {[
                  ["quick_service", "Quick Service"],
                  ["general_repair", "Repair"],
                ].map(([v, l]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => toggle(v)}
                    aria-pressed={services.includes(v)}
                    className={`flex-1 rounded-lg px-3 py-2 font-semibold ring-1 ${services.includes(v) ? "bg-brand/5 text-brand ring-2 ring-brand" : "bg-white text-neutral-700 ring-neutral-200"}`}
                  >
                    {services.includes(v) ? "✓ " : ""}
                    {l}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-neutral-700">
                Note <span className="font-normal text-neutral-500">(optional)</span>
              </span>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className={input} />
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  reset();
                  setOpen(false);
                }}
                className="flex-1 rounded-lg border border-neutral-200 px-4 py-2.5 text-sm font-semibold text-neutral-700"
              >
                Cancel
              </button>
              <button type="submit" disabled={pending || !services.length} className="flex-1 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                {pending ? "Saving…" : "Add appointment"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

/** Delete an appointment added by hand. */
export function DeleteAppointment({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Delete this appointment?")) return;
        start(async () => {
          const r = await deleteManualAppointment(id);
          if (r.error) window.alert(r.error);
          router.refresh();
        });
      }}
      className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
    >
      Delete
    </button>
  );
}
