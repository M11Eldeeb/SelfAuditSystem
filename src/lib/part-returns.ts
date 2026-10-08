import type { Database } from "@/lib/supabase/types";

export type PartReturn = Database["public"]["Tables"]["self_audit_part_returns"]["Row"];
export type PartReturnItem = Database["public"]["Tables"]["self_audit_part_return_items"]["Row"];

export const REQUEST_STATUS_LABELS: Record<PartReturn["status"], string> = {
  open: "Waiting for branch",
  dispatched: "Dispatched to warranty team",
  closed: "Sent to manufacturer",
};

export const REQUEST_STATUS_TONE: Record<PartReturn["status"], string> = {
  open: "bg-amber-50 text-amber-700 ring-amber-600/20",
  dispatched: "bg-blue-50 text-blue-700 ring-blue-600/20",
  closed: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
};

export const DEDUCTION_LABELS: Record<PartReturnItem["deduction_status"], string> = {
  none: "—",
  pending: "To be deducted",
  deducted: "Deducted",
};

/** "PR-000042" - the number printed on the box label and shown everywhere. */
export function requestLabel(requestNo: number): string {
  return `PR-${String(requestNo).padStart(6, "0")}`;
}
