import type { TechClaimStatus } from "@/lib/tech-claims/server";

export const STATUS_LABEL: Record<TechClaimStatus, string> = {
  uploading: "Not sent",
  submitted: "Waiting for review",
  returned: "Returned to technician",
  approved: "Approved",
  rejected: "Rejected",
};

const TONE: Record<TechClaimStatus, string> = {
  uploading: "bg-neutral-100 text-neutral-700",
  submitted: "bg-blue-50 text-blue-800",
  returned: "bg-amber-50 text-amber-800",
  approved: "bg-emerald-50 text-emerald-800",
  rejected: "bg-red-50 text-red-700",
};

export function StatusPill({ status }: { status: TechClaimStatus }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}

export const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" }) : "—";
