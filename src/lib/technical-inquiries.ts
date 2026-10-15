// Shared by the browser and the server - no "server-only" here on purpose.

/** Feature flag (self_audit_feature_flags) that unlocks Technical Inquiries for branch admins. */
export const INQUIRIES_FLAG = "technical_inquiries_branch_admins";
export const INQUIRY_PAGE_SIZE = 50;
export const INQUIRY_MAX_FILES = 20;
export const INQUIRY_MAX_FILE_BYTES = 200 * 1024 * 1024; // photos, PDFs and fault videos
export const INQUIRY_TEXT_MAX = 4000;
export const INQUIRY_SHORT_TEXT_MAX = 1000;
export const INQUIRY_DTC_MAX = 500;
export const INQUIRY_SOFTWARE_MAX = 120;
export const INQUIRY_MODEL_MAX = 80;
export const INQUIRY_TERM_MAX = 500;
export const INQUIRY_MAX_TERMS = 30;
export const INQUIRY_MAX_MILEAGE = 2_000_000;
/** A case that has waited longer than this (days) for the technical team or the workshop is shown in red. */
export const INQUIRY_LATE_AFTER_DAYS = 2;

/** A VIN is 17 letters and digits, never I, O or Q. */
export const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

export type InquiryStatus = "open" | "awaiting_workshop" | "closed" | "cancelled";
export type InquiryRole = "branch_admin" | "technical" | "officer";

export const STATUS_LABEL: Record<InquiryStatus, string> = {
  open: "With the technical team",
  awaiting_workshop: "Waiting for the workshop",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const STATUS_BADGE: Record<InquiryStatus, string> = {
  open: "bg-amber-50 text-amber-800 ring-amber-200",
  awaiting_workshop: "bg-sky-50 text-sky-800 ring-sky-200",
  closed: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  cancelled: "bg-neutral-100 text-neutral-600 ring-neutral-200",
};

export const SYSTEMS = ["engine", "transmission", "electrical", "adas", "infotainment", "hvac", "body", "chassis", "hybrid_ev", "other"] as const;
export type InquirySystem = (typeof SYSTEMS)[number];
export const SYSTEM_LABEL: Record<InquirySystem, string> = {
  engine: "Engine",
  transmission: "Transmission",
  electrical: "Electrical",
  adas: "ADAS / safety",
  infotainment: "Infotainment",
  hvac: "HVAC (air conditioning)",
  body: "Body",
  chassis: "Chassis / suspension / brakes",
  hybrid_ev: "Hybrid / EV",
  other: "Other",
};

export type InquiryPriority = "normal" | "urgent";
export const PRIORITY_LABEL: Record<InquiryPriority, string> = { normal: "Normal", urgent: "Urgent - customer waiting" };
export const OCCURRENCE_LABEL: Record<string, string> = { permanent: "Permanent", intermittent: "Intermittent", specific: "Under a specific condition" };
export const RESPONSIBLE_ROLE_LABEL: Record<string, string> = { workshop_supervisor: "Workshop supervisor", delegated: "Delegated responsible" };
export const AFTER_REPAIR_LABEL: Record<string, string> = { yes: "Yes - it followed a previous repair", no: "No - it is not related to a previous repair", unknown: "Not sure" };
export type AttachmentCategory = "concern_media" | "vehicle_history" | "workshop_effort" | "other";
export const CATEGORY_LABEL: Record<AttachmentCategory, string> = {
  concern_media: "Customer concern (photos / videos)",
  vehicle_history: "Vehicle history (service / repair history)",
  workshop_effort: "Workshop effort (photos / videos)",
  other: "Other files",
};
export const INQUIRY_MAX_STEPS = 30;
export const INQUIRY_STEP_MAX = 1000;
export const INQUIRY_FIRST_NOTICED_MAX = 300;
export const INQUIRY_PLATE_MAX = 20;
export const INQUIRY_PERSON_MAX = 120;

export const ROLE_LABEL: Record<string, string> = { branch_admin: "Workshop", technical: "Technical team", officer: "Warranty team" };

/** "45,200 km", or null when no mileage was given. */
export const formatMileage = (km: number | null | undefined): string | null => (km == null ? null : `${km.toLocaleString("en-US")} km`);

/** "TI-0007" */
export const inquiryLabel = (no: number) => `TI-${String(no).padStart(4, "0")}`;

/** A Drive file's address (nothing but the id is stored). */
export const driveFileUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;
export const driveFolderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;

/** Whole days a case has been waiting, or null when it is not waiting for anyone (closed, cancelled). */
export function waitingDays(waitingSince: string | null, status: InquiryStatus, now = new Date()): number | null {
  if (!waitingSince || status === "closed" || status === "cancelled") return null;
  return Math.max(0, Math.floor((now.getTime() - new Date(waitingSince).getTime()) / 86_400_000));
}

/** True when a case has been waiting for someone for more than INQUIRY_LATE_AFTER_DAYS (shown in red). */
export function isLate(waitingSince: string | null, status: InquiryStatus, now = new Date()): boolean {
  if (!waitingSince || status === "closed" || status === "cancelled") return false;
  return now.getTime() - new Date(waitingSince).getTime() > INQUIRY_LATE_AFTER_DAYS * 86_400_000;
}

/** "waiting 3 d" / "waiting 5 h" / "just now" for the list and the case page. */
export function waitingText(waitingSince: string, now = new Date()): string {
  const ms = Math.max(0, now.getTime() - new Date(waitingSince).getTime());
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

/** "3 h" / "2.5 d" for an average of milliseconds. */
export function durationText(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "-";
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (hours < 48) return `${Math.round(hours * 10) / 10} h`;
  return `${Math.round((hours / 24) * 10) / 10} d`;
}

/** The list's filter tabs for each role, the most useful first. `statuses` null means everything. */
export function statusTabs(role: InquiryRole): { key: string; label: string; statuses: InquiryStatus[] | null }[] {
  if (role === "branch_admin") {
    return [
      { key: "awaiting", label: "Needs your reply", statuses: ["awaiting_workshop"] },
      { key: "open", label: "With the technical team", statuses: ["open"] },
      { key: "closed", label: "Closed", statuses: ["closed"] },
      { key: "cancelled", label: "Cancelled", statuses: ["cancelled"] },
      { key: "all", label: "All", statuses: null },
    ];
  }
  return [
    { key: "open", label: "Needs the technical team", statuses: ["open"] },
    { key: "awaiting", label: "Waiting for the workshop", statuses: ["awaiting_workshop"] },
    { key: "closed", label: "Closed", statuses: ["closed"] },
    { key: "cancelled", label: "Cancelled", statuses: ["cancelled"] },
    { key: "all", label: "All", statuses: null },
  ];
}

export function basePathFor(role: InquiryRole): string {
  return role === "officer" ? "/admin/technical-inquiries" : role === "technical" ? "/technical/technical-inquiries" : "/audit/technical-inquiries";
}
