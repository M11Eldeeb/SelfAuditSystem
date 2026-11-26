// Quality control: the fixed choices of the QC form (shared by the browser and the server).

export const QC_PURPOSES = [
  { key: "quality_control", label: "Quality Control" },
  { key: "back_job", label: "Back Job" },
  { key: "test_drive_customer", label: "Test Drive - With Customer", group: "Test Drive" },
  { key: "test_drive_pre_repair", label: "Test Drive - Pre-Repair", group: "Test Drive" },
  { key: "test_drive_post_repair", label: "Test Drive - Post Repair", group: "Test Drive" },
  { key: "comeback", label: "Comeback" },
  { key: "diagnosis_verification", label: "Diagnosis Verification" },
] as const;
export type QcPurpose = (typeof QC_PURPOSES)[number]["key"];

/**
 * The form offers two purposes: Quality Control and Back Job. The older ones (test drives, comeback, diagnosis
 * verification) stay in QC_PURPOSES only so records saved with them still show their name.
 */
export const QC_PURPOSE_GROUPS = [
  { key: "quality_control", label: "Quality Control" },
  { key: "back_job", label: "Back Job" },
] as const;
export const QC_TEST_DRIVE_KIND_LABEL: Record<string, string> = {
  test_drive_customer: "With Customer",
  test_drive_pre_repair: "Pre-Repair",
  test_drive_post_repair: "Post Repair",
};

/**
 * The claims batches name a model by its code (AS22); people know it by name (MG RX5). Codes matched to names through the
 * VINs the batches and the Open WIPs report share. An unknown code is shown as it is.
 */
export const QC_MODEL_BY_CODE: Record<string, string> = {
  ZP22: "MG3",
  AP31: "MG5",
  IP32: "MG6",
  IP42: "MG7",
  AP32: "MG GT",
  AS32: "MG One",
  ZS11: "MG ZS",
  ZS32: "MG ZS",
  ZS11E: "MG ZS EV",
  AS23: "MG HS",
  AS33: "MG HS",
  AS33H: "MG HS Hybrid",
  AS22: "MG RX5",
  IS21: "MG RX8",
  IS31: "MG RX9",
  AS28: "MG Whale",
  T60: "MG T60",
};

/** A claims-batch model code as people know it ("AS22" -> "MG RX5"); an unknown code is shown as it is. */
export const modelName = (code: string | null | undefined): string | null => (code ? (QC_MODEL_BY_CODE[code.trim().toUpperCase()] ?? code) : null);

/** The model a free-text name from the Open WIPs report means ("MGRX8 2.0T 6AT 4WD" -> "MG RX8"), if one is clear. */
export function modelFromText(text: string | null | undefined): string | null {
  const t = (text ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!t) return null;
  const keys: [string, string][] = [
    ["ZSEV", "MG ZS EV"],
    ["HEV", "MG HS Hybrid"],
    ["RX5", "MG RX5"],
    ["RX8", "MG RX8"],
    ["RX9", "MG RX9"],
    ["WHALE", "MG Whale"],
    ["T60", "MG T60"],
    ["MGONE", "MG One"],
    ["MGGT", "MG GT"],
    ["HS", "MG HS"],
    ["ZS", "MG ZS"],
    ["MG3", "MG3"],
    ["MG5", "MG5"],
    ["MG6", "MG6"],
    ["MG7", "MG7"],
  ];
  return keys.find(([k]) => t.includes(k))?.[1] ?? null;
}

export const QC_REPAIR_TYPES = [
  { key: "periodic_maintenance", label: "Periodic Maintenance" },
  { key: "general_repair", label: "General Repair" },
  { key: "both", label: "Both" },
] as const;
export type QcRepairType = (typeof QC_REPAIR_TYPES)[number]["key"];


export const purposeLabel = (k: string | null | undefined) => QC_PURPOSES.find((p) => p.key === k)?.label ?? k ?? "—";
export const repairTypeLabel = (k: string | null | undefined) => QC_REPAIR_TYPES.find((p) => p.key === k)?.label ?? k ?? "—";

export type QcTechnician = { id: string | null; name: string };

export const QC_MAX_FILES = 40;
export const QC_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

/**
 * The root cause analysis a QC closed as failed carries: the 5 Whys, the root cause, the solution, and who it is assigned to
 * (a team leader or workshop supervisor account of the branch).
 */
export const QC_WHYS = 5;
export type QcRca = { whys: string[]; rootCause: string; solution: string; assignedTo: string };
export const emptyRca = (): QcRca => ({ whys: Array.from({ length: QC_WHYS }, () => ""), rootCause: "", solution: "", assignedTo: "" });
export type QcAssignee = { id: string; name: string; role: "team_leader" | "workshop_supervisor" };
export const ASSIGNEE_ROLE_LABEL: Record<string, string> = { team_leader: "Team leader", workshop_supervisor: "Workshop supervisor" };
/** What is still missing from a root cause analysis (null = complete). */
export function rcaMissing(rca: QcRca | undefined | null): string | null {
  if (!rca) return "Fill in the root cause analysis.";
  if (rca.whys.slice(0, QC_WHYS).length < QC_WHYS || rca.whys.slice(0, QC_WHYS).some((w) => !String(w ?? "").trim())) return "Answer all 5 Whys.";
  if (!String(rca.rootCause ?? "").trim()) return "Write the root cause of the issue.";
  if (!String(rca.solution ?? "").trim()) return "Write the solution.";
  if (!rca.assignedTo) return "Choose who the case is assigned to.";
  return null;
}
