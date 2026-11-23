// The courtesy car fleet in the portal: conditions, the service rule, transfers. Shared by the browser and the server.

export type Condition = "available" | "accident" | "maintenance" | "on_hold" | "out_of_service";
export const CONDITIONS: { id: Condition; label: string; color: string; soft: string }[] = [
  { id: "available", label: "Available", color: "#248a3d", soft: "#e8f5ec" },
  { id: "maintenance", label: "Maintenance", color: "#b45309", soft: "#fdf3e7" },
  { id: "accident", label: "Accident", color: "#d70015", soft: "#fdecee" },
  { id: "on_hold", label: "On hold", color: "#6e6e73", soft: "#f0f0f2" },
  { id: "out_of_service", label: "Out of service", color: "#3a3a3c", soft: "#e5e5ea" },
];
export const conditionOf = (c: string) => CONDITIONS.find((x) => x.id === c) ?? CONDITIONS[0];
/** A car out on an agreement shows as on loan, whatever its condition says. */
export const ON_LOAN = { label: "On loan", color: "#1d4ed8", soft: "#e8effd" };

export type TransferStatus = "requested" | "sent" | "received" | "cancelled";
export const TRANSFER_LABEL: Record<TransferStatus, string> = {
  requested: "Transfer requested",
  sent: "On its way",
  received: "Received",
  cancelled: "Cancelled",
};

export type Vehicle = {
  id: string;
  plate: string;
  plate_key: string;
  model: string | null;
  vin: string | null;
  branch_id: string | null;
  condition: Condition;
  condition_note: string | null;
  condition_at: string | null;
  km: number | null;
  last_service_km: number | null;
  last_service_at: string | null;
  service_interval_km: number;
  created_at: string;
  updated_at: string;
};

export type ServiceState = { state: "ok" | "soon" | "due" | "unknown"; nextKm: number | null; left: number | null };
/** Service every `interval` km (10,000): due at or past the next service, soon within 1,000 km of it. */
export function serviceState(v: Pick<Vehicle, "km" | "last_service_km" | "service_interval_km">): ServiceState {
  if (v.km == null) return { state: "unknown", nextKm: null, left: null };
  const interval = v.service_interval_km || 10000;
  // Never serviced in the portal: the next multiple of the interval.
  const nextKm = v.last_service_km != null ? v.last_service_km + interval : (Math.floor(v.km / interval) + 1) * interval;
  const left = nextKm - v.km;
  return { state: left <= 0 ? "due" : left <= 1000 ? "soon" : "ok", nextKm, left };
}

/** "6755 BNR", "6755-BNR", "٦٧٥٥ ب ن ر" -> one key per plate. */
export const plateKey = (p: string) =>
  p
    .replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c)))
    .toUpperCase()
    .replace(/[^A-Z0-9؀-ۿ]/g, "");

export const EVENT_LABEL: Record<string, string> = {
  added: "Added to the fleet",
  condition: "Condition changed",
  service: "Service recorded",
  km: "Mileage updated",
  loan_out: "Handed to a customer",
  loan_in: "Returned by the customer",
  transfer_requested: "Transfer requested",
  transfer_sent: "Sent to the other branch",
  transfer_received: "Received from the other branch",
  transfer_cancelled: "Transfer cancelled",
  note: "Note",
};
