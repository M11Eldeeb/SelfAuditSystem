// Shared by the browser and the server - no "server-only" here on purpose.

/** Feature flag (self_audit_feature_flags) that unlocks Technical Inquiries for branch admins. */
export const INQUIRIES_FLAG = "technical_inquiries_branch_admins";
export const INQUIRY_PAGE_SIZE = 50;
export const INQUIRY_MAX_FILES = 20;
export const INQUIRY_MAX_FILE_BYTES = 200 * 1024 * 1024; // photos, PDFs and fault videos
export const INQUIRY_TEXT_MAX = 4000;
export const INQUIRY_MODEL_MAX = 80;
export const INQUIRY_TERM_MAX = 500;
export const INQUIRY_MAX_TERMS = 30;

/** A VIN is 17 letters and digits, never I, O or Q. */
export const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

export type InquiryStatus = "open" | "awaiting_workshop" | "closed";
export type InquiryRole = "branch_admin" | "technical" | "officer";

export const STATUS_LABEL: Record<InquiryStatus, string> = {
  open: "With the technical team",
  awaiting_workshop: "Waiting for the workshop",
  closed: "Closed",
};

export const STATUS_BADGE: Record<InquiryStatus, string> = {
  open: "bg-amber-50 text-amber-800 ring-amber-200",
  awaiting_workshop: "bg-sky-50 text-sky-800 ring-sky-200",
  closed: "bg-emerald-50 text-emerald-800 ring-emerald-200",
};

export const ROLE_LABEL: Record<string, string> = { branch_admin: "Workshop", technical: "Technical team", officer: "Warranty team" };

/** "TI-0007" */
export const inquiryLabel = (no: number) => `TI-${String(no).padStart(4, "0")}`;

/** A Drive file's address (nothing but the id is stored). */
export const driveFileUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;
export const driveFolderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;

/** The list's filter tabs for each role, the most useful first. `statuses` null means everything. */
export function statusTabs(role: InquiryRole): { key: string; label: string; statuses: InquiryStatus[] | null }[] {
  if (role === "branch_admin") {
    return [
      { key: "awaiting", label: "Needs your reply", statuses: ["awaiting_workshop"] },
      { key: "open", label: "With the technical team", statuses: ["open"] },
      { key: "closed", label: "Closed", statuses: ["closed"] },
      { key: "all", label: "All", statuses: null },
    ];
  }
  return [
    { key: "open", label: "Needs the technical team", statuses: ["open"] },
    { key: "awaiting", label: "Waiting for the workshop", statuses: ["awaiting_workshop"] },
    { key: "closed", label: "Closed", statuses: ["closed"] },
    { key: "all", label: "All", statuses: null },
  ];
}

export function basePathFor(role: InquiryRole): string {
  return role === "officer" ? "/admin/technical-inquiries" : role === "technical" ? "/technical/technical-inquiries" : "/audit/technical-inquiries";
}
