"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addVehicleNote, moveTransfer, recordVehicleService, requestVehicleTransfer, setVehicleCondition, updateVehicleKm } from "@/app/actions/courtesy-fleet";
import { CONDITIONS, type Condition } from "@/lib/courtesy/fleet";

type Mode = null | "condition" | "service" | "km" | "transfer" | "note";

/**
 * What can be done with one car: the reception manager / warranty officer sets its condition, records a service or its
 * mileage, sends or receives a transfer; warranty officers / national managers ask for a transfer; anyone adds a note.
 */
export function VehicleActions({
  vehicle,
  branches,
  canManage,
  canRequest,
  canNote,
  transfer,
  myBranchId,
  compact = false,
  sheetLoan = false,
}: {
  vehicle: { id: string; condition: Condition; km: number | null; branch_id: string | null };
  branches: { id: string; name: string }[];
  canManage: boolean;
  canRequest: boolean;
  canNote: boolean;
  transfer: { id: string; status: string; from_branch: string; to_branch: string } | null;
  myBranchId: string | null;
  compact?: boolean;
  /** On loan only because the old application says so: one click marks it back and available. */
  sheetLoan?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [cond, setCond] = useState<Condition>(vehicle.condition);
  const [text, setText] = useState("");
  const [km, setKm] = useState("");
  const [date, setDate] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<{ error?: string }>) => {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (r.error) return setError(r.error);
    setMode(null);
    setText("");
    setKm("");
    router.refresh();
  };
  const mine = (b: string) => !myBranchId || myBranchId === b;
  const btn = "rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-neutral-800 hover:bg-neutral-50 disabled:opacity-50";
  const input = "w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm";

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <div className="flex flex-wrap gap-1.5">
        {canManage && sheetLoan && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!window.confirm("This car is back with us? It shows as Available from now on (the old application still says on loan).")) return;
              void run(() => setVehicleCondition(vehicle.id, "available", "Back with us - the old application still showed it on loan."));
            }}
            className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            It’s back – mark available
          </button>
        )}
        {canManage && (
          <>
            <button type="button" className={btn} onClick={() => setMode(mode === "condition" ? null : "condition")}>
              Condition
            </button>
            <button type="button" className={btn} onClick={() => setMode(mode === "service" ? null : "service")}>
              Record service
            </button>
            <button type="button" className={btn} onClick={() => setMode(mode === "km" ? null : "km")}>
              Mileage
            </button>
          </>
        )}
        {canRequest && !transfer && (
          <button type="button" className={btn} onClick={() => setMode(mode === "transfer" ? null : "transfer")}>
            Request transfer
          </button>
        )}
        {transfer?.status === "requested" && canManage && mine(transfer.from_branch) && (
          <button type="button" disabled={busy} className={`${btn} border-blue-300 bg-blue-50 text-blue-800`} onClick={() => void run(() => moveTransfer(transfer.id, "sent"))}>
            Mark sent
          </button>
        )}
        {transfer?.status === "sent" && canManage && mine(transfer.to_branch) && (
          <button type="button" disabled={busy} className={`${btn} border-emerald-300 bg-emerald-50 text-emerald-800`} onClick={() => void run(() => moveTransfer(transfer.id, "received"))}>
            Mark received
          </button>
        )}
        {transfer && (canRequest || (canManage && mine(transfer.from_branch))) && (
          <button type="button" disabled={busy} className={btn} onClick={() => window.confirm("Cancel this transfer?") && void run(() => moveTransfer(transfer.id, "cancelled"))}>
            Cancel transfer
          </button>
        )}
        {canNote && !compact && (
          <button type="button" className={btn} onClick={() => setMode(mode === "note" ? null : "note")}>
            Add note
          </button>
        )}
      </div>

      {mode === "condition" && (
        <div className="space-y-2 rounded-lg bg-neutral-50 p-2.5">
          <div className="flex flex-wrap gap-1">
            {CONDITIONS.map((c) => (
              <button key={c.id} type="button" onClick={() => setCond(c.id)} aria-pressed={cond === c.id} className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${cond === c.id ? "text-white" : "bg-white"}`} style={cond === c.id ? { backgroundColor: c.color, borderColor: c.color } : { color: c.color }}>
                {c.label}
              </button>
            ))}
          </div>
          <input className={input} placeholder={cond === "available" ? "Note (optional)" : "What happened / until when - required"} value={text} onChange={(e) => setText(e.target.value)} />
          <button type="button" disabled={busy} onClick={() => void run(() => setVehicleCondition(vehicle.id, cond, text))} className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            {busy ? "Saving…" : "Save condition"}
          </button>
        </div>
      )}
      {mode === "service" && (
        <div className="grid gap-2 rounded-lg bg-neutral-50 p-2.5 sm:grid-cols-[8rem_9rem_1fr_auto]">
          <input className={input} inputMode="numeric" placeholder="Mileage (km)" value={km} onChange={(e) => setKm(e.target.value.replace(/\D/g, "").slice(0, 7))} />
          <input className={input} type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Service date" />
          <input className={input} placeholder="Note (WIP, work done)" value={text} onChange={(e) => setText(e.target.value)} />
          <button type="button" disabled={busy} onClick={() => void run(() => recordVehicleService(vehicle.id, Number(km), date, text))} className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            Save
          </button>
        </div>
      )}
      {mode === "km" && (
        <div className="flex gap-2 rounded-lg bg-neutral-50 p-2.5">
          <input className={input} inputMode="numeric" placeholder={vehicle.km != null ? `Now ${vehicle.km.toLocaleString("en-US")} km` : "Mileage (km)"} value={km} onChange={(e) => setKm(e.target.value.replace(/\D/g, "").slice(0, 7))} />
          <button type="button" disabled={busy} onClick={() => void run(() => updateVehicleKm(vehicle.id, Number(km)))} className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            Save
          </button>
        </div>
      )}
      {mode === "transfer" && (
        <div className="space-y-2 rounded-lg bg-neutral-50 p-2.5">
          <select className={input} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To branch">
            <option value="">Transfer to branch…</option>
            {branches
              .filter((b) => b.id !== vehicle.branch_id)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
          <input className={input} placeholder="Reason / instructions for the branch" value={text} onChange={(e) => setText(e.target.value)} />
          <button type="button" disabled={busy || !to} onClick={() => void run(() => requestVehicleTransfer(vehicle.id, to, text))} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            {busy ? "Sending…" : "Ask the branch to transfer it"}
          </button>
        </div>
      )}
      {mode === "note" && (
        <div className="flex gap-2 rounded-lg bg-neutral-50 p-2.5">
          <input className={input} placeholder="Note for the car's history" value={text} onChange={(e) => setText(e.target.value)} />
          <button type="button" disabled={busy} onClick={() => void run(() => addVehicleNote(vehicle.id, text))} className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            Add
          </button>
        </div>
      )}
      {error && <p className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700">{error}</p>}
    </div>
  );
}
